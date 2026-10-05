#!/usr/bin/env node
import { Cli, z } from 'incur';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MacKeychain, validKey } from './keychain';
import { gatewayUrl, modelsPath, saveGateway, validateKey } from './gateway-config';
import { SecretInput } from './secret-input';
import { DOTENV_REMINDER, inspectCredentialPolicy } from './credential-policy';
import manifest from '../package.json';

const keychain = new MacKeychain();
const scope = {
  agentDir: z
    .string()
    .optional()
    .describe('Pi agent directory (defaults to PI_CODING_AGENT_DIR or ~/.pi/agent)'),
};
const pathFor = (agentDir?: string) => (agentDir ? join(agentDir, 'models.json') : modelsPath());
async function gateway(agentDir?: string) {
  try {
    const parsed = JSON.parse(await readFile(pathFor(agentDir), 'utf8'));
    const provider = parsed.providers?.pipellm;
    if (!provider)
      return { configured: false, models: [] as any[], baseUrl: undefined as string | undefined };
    return {
      configured: true,
      baseUrl: gatewayUrl(provider.baseUrl),
      models: (Array.isArray(provider.models) ? provider.models : []).map((m: any) => ({
        id: String(m.id),
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        adaptive: !!m.compat?.forceAdaptiveThinking,
        api: m.api || provider.api,
        baseUrl: gatewayUrl(m.baseUrl || provider.baseUrl),
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { configured: false, models: [], baseUrl: undefined };
    throw new Error('Cannot read PipeLLM configuration; check models.json syntax and permissions');
  }
}
async function discovery(agentDir?: string) {
  const environment = !!process.env.PIPELLM_API_KEY;
  const stored = keychain.supported && (await keychain.available());
  return {
    available: environment || stored,
    source: environment ? 'environment' : stored ? 'keychain' : 'none',
    environment,
    keychain: stored,
    keychainSupported: keychain.supported,
    op: 'planned',
    policy: await inspectCredentialPolicy({ agentDir }),
  };
}
async function hiddenKey(): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Error('Use --from-env or --stdin for non-interactive login');
  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;
    const input = new SecretInput(
      (value) => {
        process.stdin.off('data', receive);
        process.stdin.setRawMode(wasRaw);
        process.stdin.pause();
        input.dispose();
        process.stderr.write('\r\x1b[2K\n');
        resolve(value);
      },
      () => process.stderr.write('\r\x1b[2KPIPELLM_API_KEY: ' + input.render(80)[1]),
    );
    const receive = (data: Buffer) => input.handleInput(data.toString('utf8'));
    process.stderr.write('PIPELLM_API_KEY (hidden; Enter to submit, Esc to cancel): ');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', receive);
  });
}
async function stdinKey() {
  if (process.argv.includes('--mcp'))
    throw new Error('--stdin is unavailable with MCP; use --from-env');
  let value = '';
  for await (const chunk of process.stdin) {
    value += chunk.toString();
    if (value.length > 1024) throw new Error('API key input exceeds maximum length');
  }
  return value.trim();
}
const cli = Cli.create('pipellm-pi-provider', {
  version: manifest.version,
  description:
    'Manage PipeLLM Pi gateway configuration and macOS Keychain credentials. Keys are never printed.',
});
cli.command('status', {
  description: 'Show configuration and credential metadata without resolving secrets',
  options: z.object(scope),
  async run(c) {
    try {
      return {
        version: manifest.version,
        modelsPath: pathFor(c.options.agentDir),
        gateway: await gateway(c.options.agentDir),
        auth: await discovery(c.options.agentDir),
      };
    } catch {
      return c.error({
        code: 'STATUS_FAILED',
        message: 'Cannot inspect configuration or Keychain access',
        retryable: true,
      });
    }
  },
});
const config = Cli.create('config', {
  description: 'Inspect or configure the Pi models.json provider',
});
config.command('show', {
  description: 'Show only non-secret PipeLLM gateway/model fields',
  options: z.object(scope),
  async run(c) {
    try {
      return { path: pathFor(c.options.agentDir), ...(await gateway(c.options.agentDir)) };
    } catch {
      return c.error({
        code: 'CONFIG_FAILED',
        message: 'Cannot read PipeLLM configuration',
        retryable: false,
      });
    }
  },
});
config.command('set', {
  description: 'Merge one PipeLLM model, back up models.json, and store a Keychain/env reference',
  options: z.object({
    ...scope,
    baseUrl: z.string().describe('HTTPS Anthropic Messages gateway root'),
    model: z
      .string()
      .regex(/^[A-Za-z0-9._:/-]{1,200}$/)
      .describe('PipeLLM model ID'),
    contextWindow: z.number().int().positive().default(1048576),
    maxTokens: z.number().int().positive().default(128000),
    thinking: z.enum(['adaptive', 'native']).default('adaptive'),
    dryRun: z
      .boolean()
      .default(false)
      .describe('Validate and preview without writing configuration'),
  }),
  async run(c) {
    try {
      const o = c.options;
      const baseUrl = gatewayUrl(o.baseUrl);
      if (o.maxTokens > o.contextWindow) throw new Error('Invalid token limits');
      const model = {
        id: o.model,
        name: o.model,
        reasoning: true,
        input: ['text', 'image'] as ('text' | 'image')[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: o.contextWindow,
        maxTokens: o.maxTokens,
        compat: { forceAdaptiveThinking: o.thinking === 'adaptive' },
      };
      if (o.dryRun) return { dryRun: true, path: pathFor(o.agentDir), baseUrl, model };
      const result = await saveGateway(baseUrl, model, pathFor(o.agentDir));
      return {
        ...result,
        saved: true,
        next: 'Run auth login, then /reload and /model pipellm/' + o.model,
      };
    } catch {
      return c.error({
        code: 'CONFIG_FAILED',
        message: 'Check HTTPS URL, token limits, model ID, and models.json syntax/permissions',
        retryable: false,
      });
    }
  },
});
cli.command(config);
const auth = Cli.create('auth', {
  description: 'Discover, validate, and securely store a PipeLLM key',
});
auth.command('discover', {
  description: 'Inspect credential presence and dotenv policy without resolving credentials',
  options: z.object(scope),
  async run(c) {
    try {
      return await discovery(c.options.agentDir);
    } catch {
      return c.error({
        code: 'KEYCHAIN_DENIED',
        message: 'Cannot inspect macOS Keychain',
        retryable: true,
      });
    }
  },
});
auth.command('policy', {
  description:
    'Check for dotenv key definitions/injection indicators; report only flags and fixed warnings',
  options: z.object(scope),
  async run(c) {
    return await inspectCredentialPolicy({ agentDir: c.options.agentDir });
  },
});
const authOptions = {
  ...scope,
  model: z.string().optional().describe('Configured PipeLLM validation model'),
  yes: z
    .boolean()
    .default(false)
    .describe('Authorize one small validation request to the configured gateway'),
  dryRun: z
    .boolean()
    .default(false)
    .describe(
      'Preview target without reading secrets, requesting the gateway, or writing Keychain',
    ),
};
auth.command('login', {
  description: 'Validate a hidden input/env/stdin key, then save only to macOS Keychain',
  options: z.object({
    ...authOptions,
    fromEnv: z
      .boolean()
      .default(false)
      .describe('Read PIPELLM_API_KEY from this process environment'),
    stdin: z.boolean().default(false).describe('Read key from stdin, never from an argument'),
  }),
  async run(c) {
    let key: string | undefined;
    try {
      const o = c.options;
      const configured = await gateway(o.agentDir);
      const model = configured.models.find((m: any) =>
        o.model ? m.id === o.model : configured.models.length === 1,
      );
      if (!model)
        return c.error({
          code: 'MODEL_REQUIRED',
          message: 'Configure PipeLLM and select one model with --model',
          retryable: false,
        });
      if (o.dryRun)
        return {
          dryRun: true,
          target: model.baseUrl,
          model: model.id,
          storage: 'macOS Keychain',
          sendsRequest: false,
          credentialPolicy: DOTENV_REMINDER,
        };
      if (!o.yes)
        return c.error({
          code: 'CONFIRM_REQUIRED',
          message: 'Review auth login --dry-run, then use --yes to validate and save',
          retryable: false,
        });
      if (!keychain.supported)
        return c.error({
          code: 'KEYCHAIN_UNSUPPORTED',
          message: 'Keychain saving requires macOS; elsewhere use PIPELLM_API_KEY',
          retryable: false,
        });
      if (o.fromEnv && o.stdin) throw new Error('Choose one key source');
      const policy = await inspectCredentialPolicy({ agentDir: o.agentDir });
      if (process.stderr.isTTY) process.stderr.write(DOTENV_REMINDER + '\n');
      key = o.fromEnv
        ? process.env.PIPELLM_API_KEY
        : o.stdin
          ? await stdinKey()
          : await hiddenKey();
      if (key === undefined) return { cancelled: true };
      if (!validKey(key)) throw new Error('Invalid API key format');
      await validateKey(key, model);
      await keychain.store(key);
      return {
        validated: true,
        saved: true,
        storage: 'macOS Keychain',
        plaintextAuthWritten: false,
        credentialPolicy: policy,
      };
    } catch {
      return c.error({
        code: 'LOGIN_FAILED',
        message:
          'Check configured gateway/model, input source, API key, connectivity, and Keychain access',
        retryable: true,
      });
    } finally {
      key = undefined;
    }
  },
});
auth.command('check', {
  description: 'Validate the discovered key with one small request; no credential writes',
  options: z.object(authOptions),
  async run(c) {
    try {
      const o = c.options;
      const configured = await gateway(o.agentDir);
      const model = configured.models.find((m: any) =>
        o.model ? m.id === o.model : configured.models.length === 1,
      );
      if (!model)
        return c.error({
          code: 'MODEL_REQUIRED',
          message: 'Configure PipeLLM and select a model with --model',
          retryable: false,
        });
      if (o.dryRun)
        return {
          dryRun: true,
          target: model.baseUrl,
          model: model.id,
          sendsRequest: false,
          credentialPolicy: DOTENV_REMINDER,
        };
      if (!o.yes)
        return c.error({
          code: 'CONFIRM_REQUIRED',
          message: 'Use --yes to authorize a validation request',
          retryable: false,
        });
      const policy = await inspectCredentialPolicy({ agentDir: o.agentDir });
      if (process.stderr.isTTY) process.stderr.write(DOTENV_REMINDER + '\n');
      const key = process.env.PIPELLM_API_KEY || (await keychain.read());
      if (!key || !validKey(key)) throw new Error('No valid key found');
      await validateKey(key, model);
      return { validated: true, saved: false, model: model.id, credentialPolicy: policy };
    } catch {
      return c.error({
        code: 'CHECK_FAILED',
        message:
          'Could not validate discovered credentials; check gateway/model and Keychain access',
        retryable: true,
      });
    }
  },
});
cli.command(auth);
cli.command('doctor', {
  description:
    'Check runtime, gateway configuration and credential availability; sends no gateway request',
  options: z.object(scope),
  async run(c) {
    try {
      const configured = await gateway(c.options.agentDir);
      const auth = await discovery(c.options.agentDir);
      return {
        ready:
          Number(process.versions.node.split('.')[0]) >= 22 &&
          configured.configured &&
          configured.models.length > 0 &&
          auth.available,
        checks: {
          node22: Number(process.versions.node.split('.')[0]) >= 22,
          gatewayConfigured: configured.configured,
          modelsConfigured: configured.models.length > 0,
          credentialsAvailable: auth.available,
          keychainSupported: auth.keychainSupported,
        },
        credentialPolicy: auth.policy,
        next: !configured.configured
          ? 'config set'
          : !auth.available
            ? 'auth login'
            : '/reload, then /model pipellm/<model>',
      };
    } catch {
      return c.error({
        code: 'DOCTOR_FAILED',
        message: 'Cannot inspect configuration or Keychain access',
        retryable: true,
      });
    }
  },
});

if (process.argv[1] && (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  // Incur's explicit JSON output remains stable for agents; keep TTY output concise.
  if (!process.stdout.isTTY && !argv.includes('--mcp')) {
    if (!argv.some((a) => ['--format', '--json'].includes(a) || a.startsWith('--format=')))
      argv.push('--json');
    if (!argv.includes('--full-output')) argv.push('--full-output');
  }
  await cli.serve(argv);
}
export default cli;
