import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectCredentialPolicy } from '../src/credential-policy';
import { registerGateway } from '../src/auth';

test('dotenv assignment checks return flags and fixed warnings, without loading, echoing or changing keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipellm-policy-'));
  try {
    const content =
      '# PIPELLM_API_KEY=comment-only\nexport PIPELLM_API_KEY="synthetic-file-secret"\n';
    await writeFile(join(dir, '.env.local'), content);
    const result = await inspectCredentialPolicy({ cwd: dir, agentDir: dir, environment: {} });
    expect(result.dotenvKeyDetected).toBe(true);
    expect(result.environmentSourceUnverified).toBe(false);
    expect(JSON.stringify(result)).not.toContain('synthetic-file-secret');
    expect(JSON.stringify(result)).not.toContain(dir);
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toBe(content);
    await writeFile(
      join(dir, '.env.local'),
      '# PIPELLM_API_KEY=comment-only\nOTHER_KEY=synthetic\n',
    );
    expect(
      (await inspectCredentialPolicy({ cwd: dir, agentDir: dir, environment: {} }))
        .dotenvKeyDetected,
    ).toBe(false);
    const inherited = await inspectCredentialPolicy({
      cwd: dir,
      agentDir: dir,
      environment: {
        PIPELLM_API_KEY: 'synthetic-environment-secret',
        DOTENV_CONFIG_PATH: 'private-path',
        NODE_OPTIONS: '-r dotenv/config',
      },
    });
    expect(inherited.dotenvInjectionDetected).toBe(true);
    expect(inherited.environmentSourceUnverified).toBe(true);
    expect(JSON.stringify(inherited)).not.toContain('synthetic-environment-secret');
    expect(JSON.stringify(inherited)).not.toContain('private-path');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dotenv inspection refuses symlinks and reports bounded or incomplete inspection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipellm-policy-'));
  try {
    await writeFile(join(dir, 'outside.txt'), 'PIPELLM_API_KEY=synthetic-link-secret');
    await symlink(join(dir, 'outside.txt'), join(dir, '.env'));
    await writeFile(
      join(dir, '.env.large'),
      'x'.repeat(70000) + '\nPIPELLM_API_KEY=synthetic-tail-secret',
    );
    const result = await inspectCredentialPolicy({ cwd: dir, agentDir: dir, environment: {} });
    expect(result.dotenvKeyDetected).toBe(false);
    expect(result.inspectionIncomplete).toBe(true);
    expect(result.warnings.join('\n')).toContain(
      'Do not store or inject PIPELLM_API_KEY through .env',
    );
    expect(JSON.stringify(result)).not.toContain('synthetic-link-secret');
    expect(JSON.stringify(result)).not.toContain('synthetic-tail-secret');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pi startup surfaces the dotenv policy through the native TUI without revealing the definition', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipellm-policy-'));
  try {
    await writeFile(join(dir, '.env'), 'PIPELLM_API_KEY=synthetic-tui-secret');
    const handlers = new Map<string, any>();
    const notices: string[] = [];
    let refreshed = false;
    registerGateway(
      {
        on: (name: string, handler: any) => handlers.set(name, handler),
        registerProvider: () => {},
        registerCommand: () => {},
      } as any,
      undefined,
      undefined,
      (options) => inspectCredentialPolicy({ ...options, agentDir: dir, environment: {} }),
    );
    await handlers.get('session_start')(
      {},
      {
        cwd: dir,
        ui: { notify: (message: string) => notices.push(message) },
        modelRegistry: {
          refresh: async () => {
            refreshed = true;
          },
        },
      },
    );
    expect(refreshed).toBe(true);
    expect(notices.length).toBe(1);
    expect(notices[0]).toContain('dotenv definition');
    expect(notices[0]).toContain('macOS Keychain');
    expect(notices[0]).not.toContain('synthetic-tui-secret');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
