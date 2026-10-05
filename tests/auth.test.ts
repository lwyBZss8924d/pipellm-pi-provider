import { expect, test } from 'bun:test';
import { lstat, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MacKeychain, KEY_ACCOUNT, validKey, type SecurityRunner } from '../src/keychain';
import { SecretInput } from '../src/secret-input';
import {
  gatewayUrl,
  messagesUrl,
  saveGateway,
  validateKey,
  type GatewayModel,
} from '../src/gateway-config';
import { registerGateway } from '../src/auth';

const key = 'synthetic-secret-123456';
const model = {
  id: 'synthetic',
  provider: 'pipellm',
  api: 'anthropic-messages',
  baseUrl: 'https://example.invalid/anthropic',
};
const declaration: GatewayModel = {
  id: model.id,
  name: model.id,
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 128,
  compat: { forceAdaptiveThinking: true },
};

function memoryKeychain(initial: string | null = key) {
  let value: string | undefined = initial ?? undefined;
  const calls: { args: string[]; input?: string }[] = [];
  const run: SecurityRunner = async (args, input) => {
    calls.push({ args, input });
    if (args[0] === '-i') {
      value = input?.match(/-w "([^"]+)"/)?.[1];
      return { code: 0, stdout: '', stderr: '' };
    }
    if (!value) return { code: 44, stdout: '', stderr: '' };
    return {
      code: 0,
      stdout: args.includes('-w') ? value + '\n' : '"svce"<blob>="pipellm-pi-provider"\n',
      stderr: '',
    };
  };
  return { store: new MacKeychain(run, true), calls, value: () => value };
}
function fake(keychain = memoryKeychain()) {
  const commands = new Map<string, any>();
  const notices: string[] = [];
  let registered: any;
  registerGateway(
    {
      on: () => {},
      registerProvider: (p: any) => {
        registered = p;
      },
      registerCommand: (n: string, c: any) => commands.set(n, c),
    } as any,
    keychain.store,
    async () => {},
  );
  const ctx: any = {
    mode: 'tui',
    hasUI: true,
    model,
    modelRegistry: { getAll: () => [model], refresh: async () => {} },
    ui: {
      confirm: async () => true,
      custom: async () => key,
      notify: (message: string) => notices.push(message),
    },
  };
  return { commands, notices, provider: registered, ctx, keychain };
}

test('Keychain secret travels on stdin only; save is verified and metadata checks never request passwords', async () => {
  const backend = memoryKeychain(null);
  expect(await backend.store.available()).toBe(false);
  expect(backend.calls.every((c) => !c.args.includes('-w'))).toBe(true);
  await backend.store.store(key);
  expect(await backend.store.read()).toBe(key);
  expect(backend.calls.find((c) => c.args[0] === '-i')?.input).toContain(key);
  expect(backend.calls.every((c) => !c.args.some((arg) => arg.includes(key)))).toBe(true);
  expect(backend.calls.every((c) => !c.args.includes('-A'))).toBe(true);
  expect(validKey('bad"\nadd-generic-password')).toBe(false);
  expect(validKey('short')).toBe(false);
});
test('legacy account-only discovery works; denied access does not masquerade as a missing item', async () => {
  const calls: string[][] = [];
  const legacy = new MacKeychain(async (args) => {
    calls.push(args);
    return args.includes('-s')
      ? { code: 44, stdout: '', stderr: '' }
      : {
          code: 0,
          stdout: args.includes('-w') ? key + '\n' : '"svce"<blob>="legacy-cache"\n',
          stderr: '',
        };
  }, true);
  expect(await legacy.read()).toBe(key);
  expect(calls[1]).toEqual(['find-generic-password', '-a', KEY_ACCOUNT, '-w']);
  const denied = new MacKeychain(async () => ({ code: -1, stdout: '', stderr: key }), true);
  await expect(denied.read()).rejects.toThrow('access failed');
  await expect(denied.store(key)).rejects.toThrow('access failed');
});
test('masked TUI input never renders a secret, handles bracketed paste and clears on escape', async () => {
  const values: (string | undefined)[] = [];
  const input = new SecretInput(
    (value) => values.push(value),
    () => {},
  );
  input.handleInput('\x1b[200~' + key + '\n\x1b[201~');
  expect(values).toEqual([]);
  expect(input.render(80).join('\n')).not.toContain(key);
  expect(input.render(80)[1]).toBe('*'.repeat(key.length));
  input.handleInput('\r');
  expect(values).toEqual([key]);
  expect(input.render(80)[1]).toBe('');
  const cancelled = new SecretInput(
    (value) => values.push(value),
    () => {},
  );
  cancelled.handleInput(key);
  cancelled.handleInput('\x1b');
  await Bun.sleep(75);
  expect(values.at(-1)).toBeUndefined();
  expect(cancelled.render(80)[1]).toBe('');
});
test('validation uses one HTTPS request, refuses redirects, and redacts server error bodies', async () => {
  expect(messagesUrl('https://example.invalid/anthropic')).toBe(
    'https://example.invalid/anthropic/v1/messages',
  );
  expect(messagesUrl('https://example.invalid/v1/')).toBe('https://example.invalid/v1/messages');
  for (const url of [
    'http://example.invalid',
    'https://user:password@example.invalid',
    'https://example.invalid?key=x',
  ])
    expect(() => gatewayUrl(url)).toThrow();
  let requests = 0;
  await validateKey(key, model, (async (url: any, init: RequestInit) => {
    requests++;
    expect(url).toBe(messagesUrl(model.baseUrl));
    expect(init.redirect).toBe('error');
    expect((init.headers as any)['x-api-key']).toBe(key);
    expect(JSON.parse(init.body as string).max_tokens).toBe(1);
    return new Response(JSON.stringify({ type: 'message', model: model.id, content: [] }));
  }) as any);
  expect(requests).toBe(1);
  await expect(
    validateKey(key, model, (async () => new Response(key, { status: 401 })) as any),
  ).rejects.toThrow('HTTP 401');
  await expect(
    validateKey(key, model, (async () => new Response(JSON.stringify({ error: key }))) as any),
  ).rejects.toThrow('unexpected validation response');
});
test('masked input retains text around complete and split escape sequences without submitting pasted newlines', () => {
  const values: (string | undefined)[] = [];
  const input = new SecretInput(
    (v) => values.push(v),
    () => {},
  );
  input.handleInput('synthetic-\x1b[Asecret');
  input.handleInput('\x1b[');
  input.handleInput('1;5C-123456');
  input.handleInput('\r');
  expect(values).toEqual([key]);
  expect(input.render(80).join('\n')).not.toContain(key);
  input.handleInput('\x1b[20');
  input.handleInput('0~' + key + '\r\n\x1b[201');
  input.handleInput('~');
  expect(values).toEqual([key]);
  input.handleInput('\r');
  expect(values).toEqual([key, key]);
  input.handleInput('\x1b');
  input.handleInput('[A' + key);
  expect(values).toEqual([key, key]);
  input.handleInput('\r');
  expect(values).toEqual([key, key, key]);
});
test('disposing masked input cancels a pending ESC callback and clears the secret', async () => {
  const values: (string | undefined)[] = [];
  const input = new SecretInput(
    (v) => values.push(v),
    () => {},
  );
  input.handleInput(key);
  input.handleInput('\x1b');
  input.dispose();
  await Bun.sleep(75);
  expect(values).toEqual([]);
  expect(input.render(80)[1]).toBe('');
});
test('ESC cancellation does not redraw a credential prompt after its owner closes input', async () => {
  const events: string[] = [];
  const input = new SecretInput(
    () => {
      events.push('done');
      input.dispose();
    },
    () => events.push('redraw'),
  );
  input.handleInput(key);
  events.length = 0;
  input.handleInput('\x1b');
  await Bun.sleep(75);
  expect(events).toEqual(['done']);
});
test('gateway writes preserve file symlinks and unrelated headers, and reject dangling links unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipellm-symlink-'));
  try {
    const target = join(dir, 'shared-models.json');
    const path = join(dir, 'models.json');
    const original = JSON.stringify({
      providers: {
        pipellm: {
          models: [{ id: 'keep' }],
          authHeader: true,
          headers: {
            'X-Custom': 'keep',
            'anthropic-beta': 'synthetic-beta',
            AUTHORIZATION: 'synthetic-private-header',
            'X-Api-Key': 'synthetic-private-key',
          },
        },
      },
    });
    await writeFile(target, original);
    await symlink('shared-models.json', path);
    const saved = await saveGateway(model.baseUrl, declaration, path);
    expect((await lstat(path)).isSymbolicLink()).toBe(true);
    expect(await readFile(saved.backup!, 'utf8')).toBe(original);
    const next = JSON.parse(await readFile(target, 'utf8'));
    expect(next.providers.pipellm.headers).toEqual({
      'X-Custom': 'keep',
      'anthropic-beta': 'synthetic-beta',
    });
    expect(next.providers.pipellm.authHeader).toBeUndefined();
    expect(next.providers.pipellm.models.map((m: any) => m.id)).toEqual(['keep', model.id]);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    const dangling = join(dir, 'dangling.json');
    await symlink('missing-target.json', dangling);
    await expect(saveGateway(model.baseUrl, declaration, dangling)).rejects.toThrow();
    expect((await lstat(dangling)).isSymbolicLink()).toBe(true);
    expect((await readdir(dir)).filter((name) => name.includes('pipellm-backup'))).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('credential policy notices occur once for PipeLLM activation and remain silent for other providers', async () => {
  const handlers = new Map<string, any>();
  const notices: string[] = [];
  let inspections = 0;
  let refreshes = 0;
  registerGateway(
    {
      on: (n: string, h: any) => handlers.set(n, h),
      registerProvider: () => {},
      registerCommand: () => {},
    } as any,
    memoryKeychain().store,
    async () => {},
    async () => {
      inspections++;
      return {
        warnings: ['synthetic warning'],
        recommendation: '',
        dotenvKeyDetected: false,
        dotenvInjectionDetected: false,
        environmentSourceUnverified: true,
        inspectionIncomplete: false,
      };
    },
  );
  const ctx: any = {
    model: { provider: 'other' },
    cwd: '.',
    modelRegistry: {
      refresh: async () => {
        refreshes++;
      },
    },
    ui: { notify: (m: string) => notices.push(m) },
  };
  await handlers.get('session_start')({}, ctx);
  expect(inspections).toBe(0);
  expect(notices).toEqual([]);
  expect(refreshes).toBe(1);
  await handlers.get('model_select')({ model }, ctx);
  await handlers.get('model_select')({ model }, ctx);
  expect(notices).toEqual(['synthetic warning']);
  expect(inspections).toBe(1);
});
test('gateway configuration merges other providers/models, backs up exact bytes, and stores no entered secret', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipellm-config-'));
  try {
    const path = join(dir, 'models.json');
    const before = JSON.stringify({
      providers: {
        other: { baseUrl: 'https://other.invalid' },
        pipellm: {
          apiKey: 'legacy-synthetic-key',
          models: [{ id: 'keep' }],
        },
      },
      custom: 'keep',
    });
    await writeFile(path, before);
    const saved = await saveGateway(model.baseUrl, declaration, path);
    expect(await readFile(saved.backup!, 'utf8')).toBe(before);
    const next = JSON.parse(await readFile(path, 'utf8'));
    expect(next.providers.other.baseUrl).toBe('https://other.invalid');
    expect(next.custom).toBe('keep');
    expect(next.providers.pipellm.models.map((m: any) => m.id)).toEqual(['keep', model.id]);
    expect(next.providers.pipellm.apiKey).not.toContain('legacy-synthetic-key');
    expect(next.providers.pipellm.apiKey).toContain('PIPELLM_API_KEY');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(saved.backup!)).mode & 0o777).toBe(0o600);
    expect((await saveGateway(model.baseUrl, declaration, path)).backup).toBeUndefined();
    await expect(
      saveGateway(model.baseUrl, { ...declaration, maxTokens: 999999 }, path),
    ).rejects.toThrow('token limits');
    const savedBytes = await readFile(path, 'utf8');
    await writeFile(path, 'invalid JSON');
    await expect(saveGateway(model.baseUrl, declaration, path)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('invalid JSON');
    expect(savedBytes).not.toContain(key);
    expect((await readdir(dir)).some((name) => name.endsWith('.tmp'))).toBe(false);
  } finally {
    await rm(dir, { recursive: true });
  }
});
test('native provider ignores legacy plaintext credentials, resolves env or Keychain, and disables unsafe /login fallback', async () => {
  const f = fake();
  const auth = f.provider.auth.apiKey;
  const ctx = { env: async () => undefined };
  expect(
    (await auth.resolve({ ctx, credential: { type: 'api_key', key: 'legacy-plaintext' } })).auth
      .apiKey,
  ).toBe(key);
  expect((await auth.resolve({ ctx: { env: async () => 'synthetic-env-key' } })).auth.apiKey).toBe(
    'synthetic-env-key',
  );
  await expect(auth.login()).rejects.toThrow('/pipellm-login');
  expect(f.commands.size).toBe(3);
});
test('TUI saves only after successful validation, ignores key arguments, and cancellation writes nothing', async () => {
  const backend = memoryKeychain(null);
  const f = fake(backend);
  await f.commands.get('pipellm-login').handler(key, f.ctx);
  expect(backend.calls).toEqual([]);
  expect(f.notices.join('\n')).not.toContain(key);
  await f.commands.get('pipellm-login').handler('', {
    ...f.ctx,
    mode: 'rpc',
    ui: {
      ...f.ctx.ui,
      custom: async () => {
        throw new Error('RPC must not open terminal input');
      },
    },
  });
  expect(backend.calls).toEqual([]);
  expect(f.notices.join('\n')).toContain('terminal TUI');
  await f.commands
    .get('pipellm-login')
    .handler('', { ...f.ctx, ui: { ...f.ctx.ui, custom: async () => undefined } });
  expect(backend.calls).toEqual([]);
  await f.commands.get('pipellm-login').handler('', f.ctx);
  expect(backend.value()).toBe(key);
  expect(f.notices.join('\n')).not.toContain(key);
  const failedBackend = memoryKeychain(null);
  const commands = new Map<string, any>();
  const notices: string[] = [];
  registerGateway(
    {
      on: () => {},
      registerProvider: () => {},
      registerCommand: (n: string, c: any) => commands.set(n, c),
    } as any,
    failedBackend.store,
    async () => {
      throw new Error(key);
    },
  );
  await commands
    .get('pipellm-login')
    .handler('', { ...f.ctx, ui: { ...f.ctx.ui, notify: (s: string) => notices.push(s) } });
  expect(failedBackend.calls).toEqual([]);
  expect(notices.join('\n')).not.toContain(key);
});
