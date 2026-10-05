import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import manifest from '../package.json';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'dist');
const installer = join(output, `${manifest.name}-install.sh`);
const archive = join(output, `${manifest.name}-${manifest.version}.tgz`);
const installedPath = (process.env.PATH || '')
  .split(delimiter)
  .filter((p) => !p.endsWith('/node_modules/.bin'))
  .join(delimiter);
const pi = process.env.PIPELLM_PI_BINARY || Bun.which('pi', { PATH: installedPath });
const prime = process.env.PIPELLM_PRIME_BINARY || Bun.which('prime-agent', { PATH: installedPath });
let sandbox: string;

async function run(args: string[], cwd = root, env: NodeJS.ProcessEnv = {}) {
  const proc = Bun.spawn(args, {
    cwd,
    env: { ...process.env, PIPELLM_COMPAT_MODELS: '', ...env },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => proc.kill(), 30000);
  try {
    const [exit, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exit, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'pipellm-release-'));
  const built = await run([process.execPath, 'run', 'pack']);
  expect(built.exit).toBe(0);
}, 35000);
afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

test('release ships compiled entry, corresponding OSS sources and license without private state', async () => {
  const listed = await run(['tar', '-tzf', archive]);
  expect(listed.exit).toBe(0);
  const paths = listed.stdout.trim().split('\n');
  expect(paths).toContain('package/dist/index.js');
  for (const path of [
    'LICENSE',
    'assets/README.md',
    'assets/pipellm-code-dark.svg',
    'source/src/index.ts',
    'source/src/compat-tools.ts',
    'source/bun.lock',
    'source/AGENTS.md',
    'source/SKILL.md',
    'source/SPEC.md',
    'source/llms.txt',
    'source/scripts/build.ts',
    'source/tests/fixtures/compat-golden.json',
  ]) {
    expect(paths).toContain(`package/${path}`);
  }
  expect(
    paths.every((p) =>
      /^package\/(?:package\.json|LICENSE|SECURITY\.md|README\.md|SKILL\.md|assets\/(?:README\.md|pipellm-code-dark\.svg)|dist\/[^/]+\.js|source\/.+|THIRD_PARTY_LICENSES\/.+)$/.test(
        p,
      ),
    ),
  ).toBe(true);
  expect(paths.some((p) => /(?:node_modules|\.local|auth\.json|\.env|\.map)(?:\/|$)/.test(p))).toBe(
    false,
  );
  const release = JSON.parse(await readFile(join(output, 'package/package.json'), 'utf8'));
  expect(release.pi.extensions).toEqual(['./dist/index.js']);
  expect(release.keywords).toContain('pi-package');
  expect(release.license).toBe('MIT');
  expect(release.dependencies).toBeUndefined();
  expect(release.devDependencies).toBeUndefined();
  expect(release.scripts).toBeUndefined();
  expect(release.peerDependencies['@earendil-works/pi-coding-agent']).toBe('*');
  expect(await readFile(installer)).toEqual(
    await readFile(join(output, `${manifest.name}-${manifest.version}-install.sh`)),
  );
});

test('extracted compiled observer runs under Node with no source files or node_modules', async () => {
  const dest = join(sandbox, 'portable observer with spaces');
  expect((await run(['sh', installer, '--extract-only', dest])).exit).toBe(0);
  await rm(join(dest, 'source'), { recursive: true });
  const script = `
 import init from ${JSON.stringify(pathToFileURL(join(dest, 'dist/index.js')).href)};
 const handlers = new Map(); const warnings = []; const tools = [];
 await init({on:(n,f)=>handlers.set(n,f), registerTool:t=>tools.push(t),registerProvider:()=>{},registerCommand:()=>{}});
 const ctx = {model:{provider:"pipellm",id:"synthetic"},ui:{notify:m=>warnings.push(m)}};
 const payload = {tools:[{name:"bash"}],system:"synthetic-private-payload",messages:[]};
 const before = JSON.stringify(payload);
 const result = handlers.get("before_provider_request")({payload},ctx);
 for(let i=0;i<2;i++) handlers.get("message_end")({message:{role:"assistant",content:[{type:"toolCall",name:"unknown"}]}},ctx);
 console.log(JSON.stringify({tools:tools.length, unchanged:before===JSON.stringify(payload)&&result===undefined,
  warnings:warnings.length, redacted:!warnings[0].includes(payload.system)&&!warnings[0].includes("unknown")}));`;
  const loaded = await run(['node', '--input-type=module', '-e', script], sandbox);
  expect(loaded.exit).toBe(0);
  expect(JSON.parse(loaded.stdout)).toEqual({
    tools: 0,
    unchanged: true,
    warnings: 1,
    redacted: true,
  });
});

test('isolated release loads default and lazy compatibility tools through the native Pi loader', async () => {
  const dest = join(sandbox, 'native-loader');
  expect((await run(['sh', installer, '--extract-only', dest])).exit).toBe(0);
  await rm(join(dest, 'source'), { recursive: true });
  const loader = pathToFileURL(
    join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js'),
  ).href;
  const script = `import {loadExtensions} from ${JSON.stringify(loader)};
 const r=await loadExtensions([${JSON.stringify(join(dest, 'dist/index.js'))}],process.cwd());
 console.log(JSON.stringify({errors:r.errors, tools:r.extensions.flatMap(e=>[...e.tools.keys()]), count:r.extensions.length}));`;
  for (const [mode, tools] of [
    ['', []],
    ['synthetic', ['Bash', 'Read', 'Edit', 'Write', 'Skill', 'ToolSearch']],
  ] as const) {
    const loaded = await run([process.execPath, '-e', script], sandbox, {
      PIPELLM_COMPAT_MODELS: mode,
    });
    expect(loaded.exit).toBe(0);
    expect(JSON.parse(loaded.stdout)).toEqual({ errors: [], tools, count: 1 });
  }
});

test('failed client registration restores the previous package and rejects unowned destinations', async () => {
  const dest = join(sandbox, 'rollback');
  expect((await run(['sh', installer, '--extract-only', dest])).exit).toBe(0);
  await writeFile(join(dest, 'sentinel'), 'previous package');
  const client = join(sandbox, 'failing-fork');
  await writeFile(
    client,
    '#!/bin/sh\ncase "$*" in *--help*) echo "--extension"; exit 0;; *) exit 7;; esac\n',
    { mode: 0o755 },
  );
  const failed = await run(['sh', installer, '--prefix', dest, '--client', client]);
  expect(failed.exit).toBe(1);
  expect(await readFile(join(dest, 'sentinel'), 'utf8')).toBe('previous package');
  expect((await readdir(sandbox)).some((p) => p.startsWith('.pipellm-install.'))).toBe(false);
  const unowned = join(sandbox, 'unowned');
  await mkdir(unowned);
  await writeFile(join(unowned, 'sentinel'), 'keep');
  expect((await run(['sh', installer, '--extract-only', unowned])).exit).toBe(1);
  expect(await readFile(join(unowned, 'sentinel'), 'utf8')).toBe('keep');
});

test('damaged archive is rejected before replacing installed files', async () => {
  const text = await readFile(installer, 'utf8');
  const marker = '__PIPELLM_ARCHIVE_BELOW__\n';
  const split = text.indexOf(marker) + marker.length;
  const damaged = join(sandbox, 'damaged-install.sh');
  await writeFile(
    damaged,
    text.slice(0, split) + (text[split] === 'A' ? 'B' : 'A') + text.slice(split + 1),
  );
  const dest = join(sandbox, 'damaged');
  const result = await run(['sh', damaged, '--extract-only', dest]);
  expect(result.exit).toBe(1);
  expect(result.stderr).toContain('Archive checksum mismatch');
  expect(await Bun.file(join(dest, 'package.json')).exists()).toBe(false);
});

describe.skipIf(!pi)('installed Pi CLI (offline, isolated settings)', () => {
  test('one-command install preserves settings, repeat install is idempotent, and both runtime modes load', async () => {
    const agentDir = join(sandbox, 'pi-state');
    const cwd = join(sandbox, 'pi-project');
    const dest = join(sandbox, 'real Pi package');
    await mkdir(agentDir);
    await mkdir(cwd);
    await writeFile(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: [], theme: 'dark', syntheticMarker: 'keep' }),
    );
    await writeFile(
      join(agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          pipellm: {
            api: 'anthropic-messages',
            apiKey: '$PIPELLM_API_KEY',
            baseUrl: 'https://example.invalid/v1',
            models: [{ id: 'synthetic', contextWindow: 4096, maxTokens: 128 }],
          },
        },
      }),
    );
    const env = {
      PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: '1',
      PIPELLM_API_KEY: 'synthetic-test-key',
    };
    for (let i = 0; i < 2; i++) {
      const installed = await run(['sh', installer, '--client', pi!, '--prefix', dest], cwd, env);
      expect(installed.exit).toBe(0);
    }
    const settings = JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'));
    expect(settings.packages).toHaveLength(1);
    expect(await realpath(resolve(agentDir, settings.packages[0]))).toBe(await realpath(dest));
    expect(settings.syntheticMarker).toBe('keep');
    expect(settings.theme).toBe('dark');
    for (const mode of ['', 'synthetic']) {
      const loaded = await run([pi!, '--list-models', 'pipellm', '-nc'], cwd, {
        ...env,
        PIPELLM_COMPAT_MODELS: mode,
      });
      expect(loaded.exit).toBe(0);
      expect(loaded.stderr).not.toMatch(/Failed to load|Cannot find|Extension error/);
      expect(loaded.stdout).toContain('synthetic');
    }
  }, 35000);
});

describe.skipIf(!prime)('current Prime Agent', () => {
  test('reports missing extension runtime before writing any package or settings', async () => {
    const dest = join(sandbox, 'prime-rejected');
    const result = await run(['sh', installer, '--client', prime!, '--prefix', dest], sandbox, {
      PRIME_AGENT_CODING_AGENT_DIR: join(sandbox, 'prime-state'),
    });
    expect(result.exit).toBe(1);
    expect(result.stderr).toContain('does not advertise Pi extension loading');
    expect(await Bun.file(join(dest, 'package.json')).exists()).toBe(false);
    expect(await Bun.file(join(sandbox, 'prime-state/settings.json')).exists()).toBe(false);
  });
});

test('npm archive exposes a standalone CLI bin, schemas and safe configuration previews', async () => {
  const prefix = join(sandbox, 'npm-cli');
  const installed = await run([
    'npm',
    'install',
    '--prefix',
    prefix,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    archive,
  ]);
  expect(installed.exit).toBe(0);
  const bin = join(prefix, 'node_modules/.bin/pipellm-pi-provider');
  const agentDir = join(sandbox, 'cli-agent');
  const options = [
    'config',
    'set',
    '--agent-dir',
    agentDir,
    '--base-url',
    'https://example.invalid/anthropic',
    '--model',
    'synthetic',
  ];
  const preview = await run([bin, ...options, '--dry-run']);
  expect(preview.exit).toBe(0);
  expect(JSON.parse(preview.stdout).data.dryRun).toBe(true);
  expect(await Bun.file(join(agentDir, 'models.json')).exists()).toBe(false);
  const schema = await run([bin, 'config', 'set', '--schema', '--json']);
  expect(schema.exit).toBe(0);
  expect(JSON.parse(schema.stdout).options.properties.baseUrl.type).toBe('string');
  expect((await run([bin, ...options])).exit).toBe(0);
  const path = join(agentDir, 'models.json');
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  fixture.providers.pipellm.apiKey = 'synthetic-private-key';
  fixture.providers.pipellm.headers = { Authorization: 'synthetic-private-header' };
  await writeFile(path, JSON.stringify(fixture));
  for (const command of [
    ['config', 'show'],
    ['auth', 'login', '--dry-run'],
    ['auth', 'check', '--dry-run'],
  ]) {
    const result = await run([bin, ...command, '--agent-dir', agentDir]);
    expect(result.exit).toBe(0);
    expect(JSON.parse(result.stdout).ok).toBe(true);
    expect(result.stdout + result.stderr).not.toContain('synthetic-private');
  }
  const refused = await run(
    [bin, 'auth', 'login', '--agent-dir', agentDir, '--from-env'],
    sandbox,
    { PIPELLM_API_KEY: 'synthetic-private-key' },
  );
  expect(refused.exit).toBe(1);
  expect(JSON.parse(refused.stdout).error.code).toBe('CONFIRM_REQUIRED');
  expect(refused.stdout + refused.stderr).not.toContain('synthetic-private');
  await writeFile(join(agentDir, '.env.local'), 'PIPELLM_API_KEY=synthetic-dotenv-secret\n');
  const policy = await run([bin, 'auth', 'policy', '--agent-dir', agentDir], sandbox, {
    PIPELLM_API_KEY: '',
  });
  expect(policy.exit).toBe(0);
  expect(JSON.parse(policy.stdout).data.dotenvKeyDetected).toBe(true);
  expect(policy.stdout + policy.stderr).not.toContain('synthetic-dotenv-secret');
  expect(await readFile(join(agentDir, '.env.local'), 'utf8')).toBe(
    'PIPELLM_API_KEY=synthetic-dotenv-secret\n',
  );
  const npx = await run(
    ['npm', 'exec', '--offline', '--prefix', prefix, '--', 'pipellm-pi-provider', '--version'],
    prefix,
  );
  expect(npx.exit).toBe(0);
  expect(npx.stdout).toContain(manifest.version);
  expect(
    await Bun.file(
      join(prefix, 'node_modules/@earendil-works/pi-coding-agent/package.json'),
    ).exists(),
  ).toBe(false);
}, 35000);
