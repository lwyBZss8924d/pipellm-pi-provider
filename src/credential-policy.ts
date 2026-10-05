import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { modelsPath } from './gateway-config';

export const DOTENV_REMINDER =
  'Do not store or inject PIPELLM_API_KEY through .env files. Use /pipellm-login and macOS Keychain, or an authorized secret manager injecting only into the child process.';

type Inspection = {
  cwd?: string;
  agentDir?: string;
  environment?: NodeJS.ProcessEnv;
};

// Inspect bounded, regular dotenv files for the variable name only. Never parse, execute,
// return or import their values. Symlinks and special files are deliberately not followed.
export async function inspectCredentialPolicy(options: Inspection = {}) {
  const environment = options.environment ?? process.env;
  let dotenvKeyDetected = false;
  let inspectionIncomplete = false;
  let remaining = 32;
  const roots = new Set([
    resolve(options.cwd ?? process.cwd()),
    resolve(options.agentDir ?? dirname(modelsPath())),
  ]);
  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!/^\.env(?:\..+)?$/.test(entry.name)) continue;
        if (!entry.isFile() || remaining-- <= 0) {
          inspectionIncomplete = true;
          continue;
        }
        try {
          const file = await open(
            join(root, entry.name),
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
          );
          try {
            const metadata = await file.stat();
            if (!metadata.isFile()) {
              inspectionIncomplete = true;
              continue;
            }
            const bytes = Buffer.alloc(Math.min(metadata.size, 65536));
            try {
              const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
              if (
                /^\s*(?:export\s+)?PIPELLM_API_KEY\s*=/m.test(bytes.toString('utf8', 0, bytesRead))
              )
                dotenvKeyDetected = true;
              if (metadata.size > bytes.length) inspectionIncomplete = true;
            } finally {
              bytes.fill(0);
            }
          } finally {
            await file.close();
          }
        } catch {
          inspectionIncomplete = true;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') inspectionIncomplete = true;
    }
  }
  const dotenvInjectionDetected =
    !!environment.DOTENV_CONFIG_PATH || /dotenv(?:\/config)?/.test(environment.NODE_OPTIONS ?? '');
  const environmentSourceUnverified = !!environment.PIPELLM_API_KEY;
  const warnings: string[] = [];
  if (dotenvKeyDetected || dotenvInjectionDetected)
    warnings.push(
      'A PIPELLM_API_KEY dotenv definition or dotenv loader indicator was detected. ' +
        DOTENV_REMINDER,
    );
  if (environmentSourceUnverified)
    warnings.push(
      'PIPELLM_API_KEY is present in the environment; its origin cannot be verified. ' +
        DOTENV_REMINDER,
    );
  if (inspectionIncomplete)
    warnings.push(
      'Some dotenv files could not be inspected safely or within the inspection limit. ' +
        DOTENV_REMINDER,
    );
  return {
    dotenvKeyDetected,
    dotenvInjectionDetected,
    environmentSourceUnverified,
    inspectionIncomplete,
    recommendation: DOTENV_REMINDER,
    warnings,
  };
}
