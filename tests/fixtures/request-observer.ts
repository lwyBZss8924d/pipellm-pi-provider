import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { appendFileSync } from 'node:fs';
/** Test-only observer: retain names/booleans, never payloads, headers or arguments. */
export default function (pi: ExtensionAPI) {
  pi.on('before_provider_request', (event) => {
    const p = event.payload as any;
    appendFileSync(
      process.env.PIPELLM_OBSERVER_FILE!,
      JSON.stringify({
        thinking: p.thinking?.type ?? 'omitted',
        model: p.model,
        tool_names: (p.tools ?? []).map((t: any) => t.name),
        tool_result: (p.messages ?? []).some(
          (m: any) =>
            Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'),
        ),
        system_reminder: (p.messages ?? []).some(
          (m: any) =>
            Array.isArray(m.content) &&
            m.content.some((c: any) => c.type === 'text' && c.text?.includes('<system-reminder>')),
        ),
      }) + '\n',
    );
  });
}
