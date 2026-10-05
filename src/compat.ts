import { dirname, isAbsolute, resolve } from 'node:path';
import { homedir, platform } from 'node:os';

export interface Environment {
  cwd: string;
  home: string;
  platform: string;
  shell: string;
}
export const GATEWAY_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Skill', 'ToolSearch'];
export function compatModels(value = ''): Set<string> {
  return new Set(
    value
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id && id !== 'none'),
  );
}

function textOf(system: unknown): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((b: any) => (typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

const WINDOWS_USERS = /(?:\b[A-Za-z]:)?\\Users\\([^\\\s"'`]+)((?:\\[^\\\s"'`]*)*)/g;

/** Rewrite Windows-style user paths to this host's POSIX home layout. */
export function toPosixPaths(
  value: string,
  home = homedir(),
  windowsHost = platform() === 'win32',
): string {
  const USERS_ROOT = dirname(home);
  if (windowsHost) return value;
  return value.replace(
    WINDOWS_USERS,
    (_m, user: string, rest: string) => `${USERS_ROOT}/${user}${rest.replace(/\\/g, '/')}`,
  );
}

export function absolute(cwd: string, path: string): string {
  const posix = toPosixPaths(path);
  const expanded = posix === '~' || posix.startsWith('~/') ? homedir() + posix.slice(1) : posix;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function environmentNote(environment: Environment): string {
  const { cwd, shell, home: HOME, platform: hostPlatform } = environment;
  const WINDOWS_HOST = hostPlatform === 'win32';
  return [
    '# Actual environment (overrides any other environment description)',
    ` - Platform: ${hostPlatform}; shell: ${shell}; home: ${HOME}`,
    ` - Working directory: ${cwd}`,
    WINDOWS_HOST
      ? ''
      : ' - Use POSIX paths with forward slashes (for example ~/.agents/AGENTS.md). There is no C:\\ drive and no PowerShell.',
    ' - Tools that execute here: Bash, Read, Edit, Write, Skill, ToolSearch.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Move `system` into the first user message; the gateway forwards messages only. */
export function relocateSystem(payload: any, environment: Environment): any {
  if (!Array.isArray(payload.messages)) return payload;
  const system = [environmentNote(environment), textOf(payload.system)]
    .filter(Boolean)
    .join('\n\n');
  const reminder = { type: 'text', text: `<system-reminder>\n${system}\n</system-reminder>` };
  const messages = payload.messages.map((m: any) => ({ ...m }));
  const first = messages.findIndex((m: any) => m.role === 'user');
  if (first === -1) {
    messages.unshift({ role: 'user', content: [reminder] });
  } else {
    const content = messages[first].content;
    messages[first].content =
      typeof content === 'string'
        ? [reminder, { type: 'text', text: content }]
        : [reminder, ...(Array.isArray(content) ? content : [])];
  }
  const { system: _dropped, ...rest } = payload;
  return { ...rest, messages };
}

/** The gateway accepts only adaptive thinking for substituted models. */
export function adaptiveThinking(payload: any): any {
  const t = payload.thinking;
  if (!t || t.type === 'adaptive' || t.type === 'disabled') {
    // "disabled" is rejected by adaptive-only models; drop it and let the model decide.
    if (t?.type === 'disabled') {
      const { thinking: _t, ...rest } = payload;
      return rest;
    }
    return payload;
  }
  const { budget_tokens: _b, ...keep } = t;
  return { ...payload, thinking: { ...keep, type: 'adaptive' } };
}
