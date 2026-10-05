import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { homedir, platform } from 'node:os';
import { adaptiveThinking, compatModels, GATEWAY_TOOLS, relocateSystem } from './compat';
import { createToolGuard } from './contract';
import { registerGateway } from './auth';

/** Pi-only observer. Model declarations and thinking policy belong in models.json. */
export default async function (pi: ExtensionAPI) {
  registerGateway(pi);
  const models = compatModels(process.env.PIPELLM_COMPAT_MODELS);
  const guard = createToolGuard();
  let active: boolean | undefined;
  let savedTools: string[] | undefined;
  const compatible = (model: { provider?: string; id?: string } | undefined) =>
    model?.provider === 'pipellm' && models.has(String(model.id));
  if (models.size) {
    const { registerCompatTools } = await import('./compat-tools');
    registerCompatTools(pi);
  }
  const sync = (model: { provider?: string; id?: string } | undefined) => {
    if (!models.size) return;
    const want = compatible(model);
    if (want === active) return;
    if (want) {
      savedTools = pi.getActiveTools().filter((name) => !GATEWAY_TOOLS.includes(name));
      pi.setActiveTools([...savedTools, ...GATEWAY_TOOLS]);
    } else {
      pi.setActiveTools(
        savedTools ?? pi.getActiveTools().filter((name) => !GATEWAY_TOOLS.includes(name)),
      );
    }
    active = want;
  };
  pi.on('session_start', (_event, ctx) => {
    guard.reset();
    sync(ctx.model);
  });
  pi.on('model_select', (event) => {
    guard.request(undefined);
    sync(event.model);
  });
  pi.on('before_agent_start', (_event, ctx) => sync(ctx.model));
  pi.on('before_provider_request', (event, ctx) => {
    guard.request(ctx.model?.provider === 'pipellm' ? event.payload : undefined);
    if (!compatible(ctx.model)) return;
    const payload = event.payload as any;
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) return;
    return adaptiveThinking(
      relocateSystem(payload, {
        cwd: ctx.cwd,
        home: homedir(),
        platform: platform(),
        shell: process.env.SHELL || '/bin/sh',
      }),
    );
  });
  pi.on('message_end', (event, ctx) => {
    if (ctx.model?.provider !== 'pipellm' || event.message.role !== 'assistant') return;
    for (const block of event.message.content) {
      if (block.type !== 'toolCall' || !guard.observe(block.name)) continue;
      const message =
        'PipeLLM returned a tool absent from the request. Check gateway passthrough with gateway-probe.';
      if (ctx.hasUI === false) console.warn(message);
      else ctx.ui.notify(message, 'warning');
    }
  });
}
