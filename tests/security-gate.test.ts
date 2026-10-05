import { expect, test } from 'bun:test';
import { releaseGate } from '../scripts/security-gate';
import type { ScanResult } from '@openai/codex-security';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('release scanner configuration passes the pinned SDK offline preflight', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pipellm-security-preflight-'));
  try {
    const proc = Bun.spawn([process.execPath, 'scripts/security-scan.ts', '.', '--preflight'], {
      env: {
        ...process.env,
        CODEX_HOME: join(temporary, 'codex-home'),
        CODEX_SECURITY_OUTPUT_DIR: join(temporary, 'reports'),
        CODEX_SECURITY_MODEL: 'gpt-6-sol',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(stderr).toBe('');
    expect(exit).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      preflight: true,
      authentication: 'stored_credentials',
      model: 'gpt-6-sol',
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 15000);

test('release gate refuses errors, partial coverage, deferred review and high findings', () => {
  const result = (
    status = 'completed',
    completeness = 'complete',
    deferred: object[] = [],
    blocked = false,
  ) =>
    ({
      manifest: { scan: { status } },
      coverage: { completeness, deferred },
      findings: { findings: [] },
      hasFindingsAtOrAbove: (threshold: string) => {
        expect(threshold).toBe('high');
        return blocked;
      },
    }) as unknown as ScanResult;
  expect(releaseGate(result()).passed).toBe(true);
  for (const fixture of [
    result('failed'),
    result('interrupted'),
    result('completed', 'partial'),
    result('completed', 'unknown'),
    result('completed', 'complete', [{}]),
    result('completed', 'complete', [], true),
  ]) {
    expect(releaseGate(fixture).passed).toBe(false);
  }
});
