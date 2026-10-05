import { CodexSecurity } from '@openai/codex-security';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { releaseGate } from './security-gate';

const repository = resolve(process.argv[2] || '.');
const outputDir =
  process.env.CODEX_SECURITY_OUTPUT_DIR || (await mkdtemp(join(tmpdir(), 'pipellm-security-')));
await mkdir(outputDir, { recursive: true, mode: 0o700 });
// Pin the native runtime separately: this SDK version bundles an older Codex CLI.
const require = createRequire(import.meta.url);
const codexPackage = require.resolve('@openai/codex/package.json');
const codexVersion = JSON.parse(await readFile(codexPackage, 'utf8')).version;
process.env.CODEX_CLI_PATH = join(dirname(codexPackage), 'bin/codex.js');
const model = process.env.CODEX_SECURITY_MODEL || 'gpt-6.1-sol';
const serviceTier = process.env.CODEX_SECURITY_SERVICE_TIER || 'default';
const security = new CodexSecurity({
  codexOverrides: {
    model,
    model_reasoning_effort: 'high',
    service_tier: serviceTier,
    features: {
      fast_mode: serviceTier === 'fast',
      multi_agent_v2: { enabled: true, max_concurrent_threads_per_session: 3 },
    },
  },
});
try {
  if (serviceTier !== 'default' && serviceTier !== 'fast') {
    throw new Error('Security service tier must be default or fast');
  }
  const options = {
    auth: 'chatgpt' as const,
    mode: 'standard' as const,
    outputDir,
    knowledgeBasePaths: [join(repository, 'SECURITY.md')],
    failureSeverity: 'high' as const,
  };
  if (process.argv.includes('--preflight')) {
    const preview = await security.preflight(repository, options);
    console.log(
      JSON.stringify({
        preflight: true,
        authentication: preview.authentication.method,
        model: preview.model,
        codexVersion,
        serviceTier,
      }),
    );
  } else {
    const startedAt = Date.now();
    const elapsedSeconds = () => Math.floor((Date.now() - startedAt) / 1000);
    const heartbeat = setInterval(() => {
      console.log(JSON.stringify({ event: 'scan_active', elapsedSeconds: elapsedSeconds() }));
    }, 30000);
    let result;
    try {
      result = await security.run(repository, {
        ...options,
        onScanStarted() {
          console.log(
            JSON.stringify({
              event: 'scan_started',
              model,
              effort: 'high',
              serviceTier,
              codexVersion,
            }),
          );
        },
        onProgress(progress) {
          const phases = [
            'preflight',
            'threat_model',
            'discovery',
            'validation',
            'attack_path',
            'reporting',
          ];
          const count = (value: number) =>
            Number.isSafeInteger(value) && value >= 0 ? value : null;
          console.log(
            JSON.stringify({
              event: 'scan_progress',
              elapsedSeconds: elapsedSeconds(),
              phase: phases.includes(progress.phase) ? progress.phase : 'unknown',
              filesCompleted: count(progress.filesCompleted),
              filesTotal: count(progress.filesTotal),
            }),
          );
        },
      });
    } finally {
      clearInterval(heartbeat);
    }
    const gate = releaseGate(result);
    // Publish only aggregate gate metadata; detailed reports remain on the runner.
    console.log(
      JSON.stringify({
        ...gate,
        codexVersion,
        model,
        effort: 'high',
        serviceTier,
        elapsedSeconds: elapsedSeconds(),
      }),
    );
    await writeFile(join(outputDir, 'release-gate.json'), JSON.stringify(gate, null, 2) + '\n', {
      mode: 0o600,
    });
    if (!gate.passed) process.exitCode = 1;
  }
} catch (error) {
  // Keep SDK diagnostics on the runner, including any local filesystem paths.
  await writeFile(
    join(outputDir, 'failure.log'),
    error instanceof Error ? error.stack || error.message : String(error),
    { mode: 0o600 },
  );
  const message = error instanceof Error ? error.message : '';
  const reason = message.includes('at capacity')
    ? 'model_capacity'
    : message.includes('not supported')
      ? 'model_not_supported'
      : 'scan_error';
  console.error(JSON.stringify({ passed: false, reason, diagnostics: 'runner-local' }));
  process.exitCode = 2;
} finally {
  await security.close();
}
