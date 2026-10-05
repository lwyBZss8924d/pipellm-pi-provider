import { describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

describe.skipIf(process.env.PIPELLM_LIVE !== '1' || process.env.PIPELLM_E2E !== '1')(
  'live client contracts',
  () => {
    for (const client of ['pi', 'prime-agent'])
      for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
        for (const mode of client === 'pi' ? ['default', 'no-extensions'] : ['default']) {
          test(`${client} ${model} ${mode}: native nonce round trip with thinking max`, async () => {
            const cwd = await mkdtemp(join(tmpdir(), 'pipellm-e2e-'));
            const nonce = randomBytes(12).toString('hex');
            const observer = join(cwd, 'request-metadata.jsonl');
            try {
              await writeFile(join(cwd, 'probe-nonce.txt'), nonce);
              // bun run prepends development .bin entries; resolve the user's installed clients.
              const binary =
                process.env[client === 'pi' ? 'PIPELLM_PI_BINARY' : 'PIPELLM_PRIME_BINARY'] ||
                Bun.which(client, {
                  PATH: (process.env.PATH || '')
                    .split(delimiter)
                    .filter((entry) => !entry.endsWith('/node_modules/.bin'))
                    .join(delimiter),
                });
              if (!binary)
                throw new Error(
                  `Installed ${client} unavailable; set its PIPELLM_*_BINARY override`,
                );
              const argv = [
                binary,
                '-p',
                '--no-session',
                '--mode',
                'json',
                '--provider',
                'pipellm',
                '--model',
                model,
                '--thinking',
                'max',
              ];
              if (client === 'prime-agent') argv.push('--offline');
              if (mode === 'no-extensions') argv.push('-ne');
              if (client === 'pi')
                argv.push(
                  '-e',
                  fileURLToPath(new URL('./fixtures/request-observer.ts', import.meta.url)),
                );
              argv.push(
                '--',
                'Use your shell tool to run cat probe-nonce.txt, then reply with its exact output.',
              );
              const proc = Bun.spawn(argv, {
                cwd,
                env: { ...process.env, PIPELLM_OBSERVER_FILE: observer },
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe',
              });
              const timer = setTimeout(() => proc.kill(), 90000);
              let exit: number, raw: string;
              try {
                const result = await Promise.all([
                  proc.exited,
                  new Response(proc.stdout).text(),
                  new Response(proc.stderr).text(),
                ]);
                exit = result[0];
                raw = result[1];
              } finally {
                clearTimeout(timer);
              }
              expect(exit).toBe(0);
              expect(raw.includes(nonce)).toBe(true);
              expect(/Tool \w+ not found/.test(raw)).toBe(false);
              expect(raw.includes('C:\\Users')).toBe(false);
              if (client === 'pi') {
                const requests = (await readFile(observer, 'utf8'))
                  .trim()
                  .split('\n')
                  .map((line) => JSON.parse(line));
                expect(requests.length > 1).toBe(true);
                expect(
                  requests.every(
                    (r) => r.model === model && r.thinking !== 'enabled' && !r.system_reminder,
                  ),
                ).toBe(true);
                expect(requests.some((r) => r.tool_result)).toBe(true);
                expect(
                  requests.every(
                    (r) => r.tool_names.includes('bash') && !r.tool_names.includes('Bash'),
                  ),
                ).toBe(true);
              }
              if (process.env.PIPELLM_E2E_RECEIPT)
                await appendFile(
                  process.env.PIPELLM_E2E_RECEIPT,
                  JSON.stringify({ client, binary, model, mode, pass: true }) + '\n',
                );
            } finally {
              await rm(cwd, { recursive: true, force: true });
            }
          }, 95000);
        }
      }
  },
);
