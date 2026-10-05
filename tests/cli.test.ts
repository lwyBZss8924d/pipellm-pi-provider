import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import manifest from '../package.json';

test('source Bun CLI exits without an HTTP listener for version, help and dry-run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pipellm-cli-'));
  try {
    for (const args of [
      ['--version'],
      ['--help'],
      [
        'config',
        'set',
        '--base-url',
        'https://example.invalid/anthropic',
        '--model',
        'synthetic',
        '--dry-run',
      ],
    ]) {
      const proc = Bun.spawn([process.execPath, '--no-env-file', resolve('src/cli.ts'), ...args], {
        cwd: dir,
        env: { PATH: process.env.PATH, HOME: dir, PI_CODING_AGENT_DIR: dir, PIPELLM_API_KEY: '' },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timeout = setTimeout(() => proc.kill(), 5000);
      try {
        const [exit, out, err] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        expect(exit).toBe(0);
        expect(out + err).not.toContain('Started development server');
        if (args[0] === '--version') expect(out.trim()).toBe(manifest.version);
      } finally {
        clearTimeout(timeout);
      }
    }
    expect(await Bun.file(join(dir, 'models.json')).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
