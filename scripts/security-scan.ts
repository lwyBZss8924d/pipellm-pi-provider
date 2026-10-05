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
const security = new CodexSecurity({
  codexOverrides: {
    model: process.env.CODEX_SECURITY_MODEL || 'gpt-6.1-sol',
    model_reasoning_effort: 'high',
    features: {
      multi_agent_v2: { enabled: true, max_concurrent_threads_per_session: 3 },
    },
  },
});
try {
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
      }),
    );
  } else {
    const result = await security.run(repository, options);
    const gate = releaseGate(result);
    // Publish only aggregate gate metadata; detailed reports remain on the runner.
    console.log(JSON.stringify({ ...gate, codexVersion }));
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
