import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('live probes reject HTTP before credential lookup or any network request', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pipellm-probe-transport-'));
  const bin = join(temporary, 'bin');
  const marker = join(temporary, 'credential-read');
  await mkdir(bin);
  await writeFile(
    join(bin, 'security'),
    '#!/bin/sh\nprintf read > "$PIPELLM_SYNTHETIC_READ"\nprintf synthetic-probe-key\n',
    { mode: 0o700 },
  );
  let requests = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      requests++;
      return Response.json({ type: 'error', error: { message: 'synthetic' } });
    },
  });
  try {
    const proc = Bun.spawn([process.execPath, 'test', 'tests/live.test.ts'], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PIPELLM_LIVE: '1',
        PIPELLM_API_KEY: undefined,
        PIPELLM_BASE_URL: `http://127.0.0.1:${server.port}`,
        PIPELLM_SYNTHETIC_READ: marker,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(exit).not.toBe(0);
    expect(stderr).toContain('HTTPS gateway URL');
    expect(requests).toBe(0);
    expect(
      await stat(marker).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(stdout + stderr).not.toContain('synthetic-probe-key');
  } finally {
    server.stop(true);
    await rm(temporary, { recursive: true, force: true });
  }
}, 10000);
