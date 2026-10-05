import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function modelsPath() {
  return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent'), 'models.json');
}
export function gatewayUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTPS gateway URL without credentials, query, or fragment');
  }
  return url.href.replace(/\/$/, '');
}
export function messagesUrl(baseUrl: string): string {
  const url = gatewayUrl(baseUrl);
  return url.endsWith('/v1') ? `${url}/messages` : `${url}/v1/messages`;
}
export type GatewayModel = {
  id: string;
  name: string;
  reasoning: boolean;
  input: ('text' | 'image')[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  compat: { forceAdaptiveThinking: boolean };
};
export async function saveGateway(baseUrl: string, model: GatewayModel, path = modelsPath()) {
  baseUrl = gatewayUrl(baseUrl);
  if (
    !/^[A-Za-z0-9._:/-]{1,200}$/.test(model.id) ||
    !Number.isSafeInteger(model.contextWindow) ||
    model.contextWindow <= 0 ||
    !Number.isSafeInteger(model.maxTokens) ||
    model.maxTokens <= 0 ||
    model.maxTokens > model.contextWindow
  ) {
    throw new Error('Invalid model identifier or token limits');
  }
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // Resolve a file symlink before atomic replacement; a dangling link fails unchanged.
  if (entry?.isSymbolicLink()) path = await realpath(path);
  await mkdir(dirname(path), { recursive: true });
  let original: string | undefined;
  try {
    original = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const config = original === undefined ? {} : JSON.parse(original);
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    (config.providers !== undefined &&
      (!config.providers ||
        typeof config.providers !== 'object' ||
        Array.isArray(config.providers)))
  ) {
    throw new Error('Invalid models.json; no configuration was changed');
  }
  const previous = config.providers?.pipellm ?? {};
  if (
    !previous ||
    typeof previous !== 'object' ||
    Array.isArray(previous) ||
    (previous.models !== undefined && !Array.isArray(previous.models))
  )
    throw new Error('Invalid PipeLLM configuration');
  const { apiKey: _key, headers: _headers, authHeader: _authHeader, ...safePrevious } = previous;
  if (
    _headers !== undefined &&
    (!_headers || typeof _headers !== 'object' || Array.isArray(_headers))
  )
    throw new Error('Invalid PipeLLM headers');
  const headers = Object.fromEntries(
    Object.entries(_headers ?? {}).filter(
      ([name]) => !/^(?:authorization|proxy-authorization|x-api-key|api-key)$/i.test(name),
    ),
  );
  // Preserve other providers and model entries; selected model has no literal auth headers.
  config.providers = {
    ...config.providers,
    pipellm: {
      ...safePrevious,
      ...(Object.keys(headers).length ? { headers } : {}),
      api: 'anthropic-messages',
      baseUrl,
      apiKey:
        process.platform === 'darwin'
          ? '!if [ -n "$PIPELLM_API_KEY" ]; then printf \'%s\' "$PIPELLM_API_KEY"; else /usr/bin/security find-generic-password -a PIPELLM_API_KEY -w; fi'
          : '$PIPELLM_API_KEY',
      models: [...(previous.models ?? []).filter((item: any) => item.id !== model.id), model],
    },
  };
  const next = JSON.stringify(config, null, 2) + '\n';
  if (next === original) return { path, backup: undefined };
  const suffix = randomUUID();
  const backup = original === undefined ? undefined : `${path}.pipellm-backup-${suffix}`;
  if (backup) await writeFile(backup, original!, { mode: 0o600, flag: 'wx' });
  const temp = `${path}.pipellm-${suffix}.tmp`;
  try {
    await writeFile(temp, next, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
  return { path, backup };
}

export async function validateKey(
  key: string,
  model: { id: string; baseUrl: string; api: string },
  fetcher: typeof fetch = fetch,
) {
  if (model.api !== 'anthropic-messages')
    throw new Error('Select an Anthropic Messages PipeLLM model');
  const response = await fetcher(messagesUrl(model.baseUrl), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens: 1,
      stream: false,
      messages: [{ role: 'user', content: 'Reply OK.' }],
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`PipeLLM key validation failed (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as any;
  if (
    payload?.type !== 'message' ||
    !Array.isArray(payload.content) ||
    typeof payload.model !== 'string'
  ) {
    throw new Error('PipeLLM returned an unexpected validation response');
  }
}
