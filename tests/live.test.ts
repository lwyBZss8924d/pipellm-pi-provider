import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { classifyResponse, classifySize, retryForcedToolChoice } from '../src/classify';

// No calls or credential lookups unless explicitly enabled.
describe.skipIf(process.env.PIPELLM_LIVE !== '1')('live PipeLLM contracts', () => {
  let key: string;
  const base = process.env.PIPELLM_BASE_URL || 'https://cc-api.pipellm.ai/anthropic';
  beforeAll(() => {
    key =
      process.env.PIPELLM_API_KEY ||
      (process.platform === 'darwin'
        ? spawnSync('security', ['find-generic-password', '-a', 'PIPELLM_API_KEY', '-w'], {
            encoding: 'utf8',
          }).stdout?.trim()
        : '') ||
      '';
    if (!key) throw new Error('PipeLLM key unavailable through environment or Keychain');
  });
  async function post(body: Record<string, unknown>) {
    const response = await fetch(`${base.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'user-agent': 'pipellm-contract/0.2',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    return { status: response.status, body: (await response.json()) as any };
  }
  for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
    let toolResponse: any;
    const tool = `canary_${randomBytes(5).toString('hex')}`;
    const toolRequest = {
      model,
      max_tokens: 2048,
      tools: [
        {
          name: tool,
          description: 'Read the probe result. Call this tool to obtain it.',
          input_schema: { type: 'object', properties: {}, required: [] },
        },
      ],
      messages: [{ role: 'user', content: `Call ${tool} now, then repeat its result exactly.` }],
    };
    test(`${model}: system, native tool choice, summed usage and served model`, async () => {
      const small = await post({
        model,
        max_tokens: 2048,
        system: 'Session cwd=/synthetic/live-probe; platform=darwin. Report these claims exactly.',
        messages: [{ role: 'user', content: 'Report the session cwd and platform.' }],
      });
      expect(small.status).toBe(200);
      expect(small.body.model).toBe(model);
      const text = small.body.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join(' ');
      expect(text).toContain('/synthetic/live-probe');
      expect(text.toLowerCase()).toContain('darwin');
      const forced = await post({ ...toolRequest, tool_choice: { type: 'any' } });
      expect(retryForcedToolChoice(forced.status, forced.body)).toBe(true);
      const auto = await post(toolRequest);
      expect(auto.status).toBe(200);
      expect(classifyResponse(auto.status, [tool], auto.body)).toBe('PASSTHROUGH');
      expect(auto.body.content.some((c: any) => c.type === 'tool_use' && c.name === tool)).toBe(
        true,
      );
      expect(auto.body.model).toBe(model);
      toolResponse = auto.body;
      const large = await post({
        model,
        max_tokens: 2048,
        system: Array.from(
          { length: 1500 },
          (_, i) => `filler${i}-${randomBytes(4).toString('hex')}`,
        ).join(' '),
        messages: [{ role: 'user', content: 'Reply OK.' }],
      });
      expect(large.status).toBe(200);
      expect(large.body.model).toBe(model);
      expect(classifySize(small.body.usage, large.body.usage)).toBe('PASSTHROUGH');
    }, 240000);
    test(`${model}: enabled/disabled rejected; adaptive/omitted accepted`, async () => {
      for (const [thinking, status] of [
        [{ type: 'enabled', budget_tokens: 1024 }, 400],
        [{ type: 'disabled' }, 400],
        [{ type: 'adaptive' }, 200],
        [undefined, 200],
      ] as const) {
        const response = await post({
          model,
          max_tokens: 2048,
          ...(thinking ? { thinking } : {}),
          messages: [{ role: 'user', content: 'Reply OK.' }],
        });
        expect(response.status).toBe(status);
        if (status === 200) expect(response.body.model).toBe(model);
      }
    }, 240000);
    test(`${model}: tool-result round trip stays adaptive`, async () => {
      expect(toolResponse).toBeDefined();
      const result = `RESULT-${randomBytes(8).toString('hex')}`;
      const toolCalls = toolResponse.content.filter((c: any) => c.type === 'tool_use');
      const response = await post({
        ...toolRequest,
        thinking: { type: 'adaptive' },
        messages: [
          ...toolRequest.messages,
          { role: 'assistant', content: toolResponse.content },
          {
            role: 'user',
            content: toolCalls.map((c: any) => ({
              type: 'tool_result',
              tool_use_id: c.id,
              content: result,
            })),
          },
        ],
      });
      expect(response.status).toBe(200);
      expect(response.body.model).toBe(model);
      expect(
        response.body.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join(' '),
      ).toContain(result);
    }, 90000);
  }
});
