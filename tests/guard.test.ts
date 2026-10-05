import { afterEach, expect, test } from 'bun:test';
import init from '../src/index';
import fixtures from './fixtures/responses.json';
afterEach(() => {
  delete process.env.PIPELLM_COMPAT_MODELS;
  delete process.env.PIPELLM_SUBSTITUTED_MODELS;
});

function fake() {
  const handlers = new Map<string, Function>();
  const warnings: string[] = [];
  const registered: any[] = [];
  let active = ['bash', 'read'];
  const pi = {
    registerProvider: () => {},
    registerCommand: () => {},
    on: (name: string, fn: Function) => handlers.set(name, fn),
    registerTool: (tool: any) => {
      registered.push(tool);
      active.push(tool.name);
    },
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
  };
  const ctx = {
    model: { provider: 'pipellm', id: 'claude-opus-5-5' },
    cwd: '/synthetic/project',
    ui: { notify: (text: string) => warnings.push(text) },
  };
  return { handlers, warnings, registered, pi, ctx, active: () => active };
}
const message = (name: string) => ({
  message: { role: 'assistant', content: [{ type: 'toolCall', name }] },
});
test('default requests and native tools stay unchanged; guard fires once per session', async () => {
  delete process.env.PIPELLM_COMPAT_MODELS;
  process.env.PIPELLM_SUBSTITUTED_MODELS = 'claude-opus-5-5';
  const f = fake();
  await init(f.pi as any);
  for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
    f.ctx.model.id = id;
    f.handlers.get('session_start')!({}, f.ctx);
    const payload = {
      system: 'payload-never-in-warning',
      tools: [{ name: 'bash' }],
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'adaptive' },
    };
    const before = structuredClone(payload);
    expect(f.handlers.get('before_provider_request')!({ payload }, f.ctx)).toBeUndefined();
    expect(payload).toEqual(before);
    expect(f.active()).toEqual(['bash', 'read']);
    expect(f.registered).toHaveLength(0);
    expect(f.handlers.get('message_end')!(message('bash'), f.ctx)).toBeUndefined();
    const old = f.warnings.length;
    for (const _ of [1, 2])
      expect(
        f.handlers.get('message_end')!(message(fixtures.substituted.content[0].name), f.ctx),
      ).toBeUndefined();
    expect(f.warnings.length).toBe(old + 1);
    expect(f.warnings.at(-1)).not.toContain(payload.system);
  }
  delete process.env.PIPELLM_SUBSTITUTED_MODELS;
});
test('other providers and calls before a request never warn', async () => {
  const f = fake();
  await init(f.pi as any);
  f.handlers.get('message_end')!(message('Bash'), f.ctx);
  f.ctx.model.provider = 'other';
  f.handlers.get('before_provider_request')!({ payload: { tools: [] } }, f.ctx);
  f.handlers.get('message_end')!(message('Bash'), f.ctx);
  expect(f.warnings).toEqual([]);
});
test('compatibility tools and transforms require an explicitly selected model', async () => {
  process.env.PIPELLM_COMPAT_MODELS = 'claude-opus-5-5';
  const f = fake();
  await init(f.pi as any);
  f.handlers.get('session_start')!({}, f.ctx);
  expect(f.registered.map((t) => t.name)).toEqual([
    'Bash',
    'Read',
    'Edit',
    'Write',
    'Skill',
    'ToolSearch',
  ]);
  expect(f.active()).toEqual(['bash', 'read', ...f.registered.map((t) => t.name)]);
  const payload = {
    system: 'fixture system',
    messages: [{ role: 'user', content: 'hello' }],
    thinking: { type: 'enabled', budget_tokens: 1024 },
  };
  const changed = f.handlers.get('before_provider_request')!({ payload }, f.ctx);
  expect(changed.system).toBeUndefined();
  expect(changed.thinking).toEqual({ type: 'adaptive' });
  f.ctx.model.id = 'claude-sonnet-5-5';
  f.handlers.get('model_select')!({ model: f.ctx.model }, f.ctx);
  expect(f.active()).toEqual(['bash', 'read']);
  expect(f.handlers.get('before_provider_request')!({ payload }, f.ctx)).toBeUndefined();
});
test('an initial unlisted model never exposes compatibility tools', async () => {
  process.env.PIPELLM_COMPAT_MODELS = 'claude-opus-5-5';
  const f = fake();
  f.ctx.model.id = 'claude-sonnet-5-5';
  await init(f.pi as any);
  f.handlers.get('session_start')!({}, f.ctx);
  expect(f.active()).toEqual(['bash', 'read']);
});
test('unknown model tool calls are observed before native lookup, even without tool_call', async () => {
  const f = fake();
  await init(f.pi as any);
  f.handlers.get('before_provider_request')!({ payload: { tools: [{ name: 'bash' }] } }, f.ctx);
  expect(f.handlers.has('tool_call')).toBe(false);
  f.handlers.get('message_end')!(message('Bash'), f.ctx);
  expect(f.warnings).toHaveLength(1);
  f.handlers.get('message_end')!({ message: { role: 'toolResult', toolName: 'Bash' } }, f.ctx);
  expect(f.warnings).toHaveLength(1);
});
test('an explicit request without tools still detects invented tool calls', async () => {
  const f = fake();
  await init(f.pi as any);
  f.handlers.get('before_provider_request')!({ payload: { messages: [] } }, f.ctx);
  f.handlers.get('message_end')!(message('Bash'), f.ctx);
  expect(f.warnings).toHaveLength(1);
});
