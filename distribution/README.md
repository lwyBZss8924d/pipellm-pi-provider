# pipellm-pi-provider

Connect Pi to the PipeLLM gateway using the Anthropic Messages API. Configure models, sign in
through macOS Keychain, and manage settings with Pi slash commands or the Incur CLI.

Built with Pi's [custom provider API](https://pi.dev/docs/latest/custom-provider),
[extension API](https://pi.dev/docs/latest/extensions) and
[package format](https://pi.dev/docs/latest/packages). The npm package includes compiled JavaScript,
corresponding source/tests in `source/`, and CLI dependency notices in `THIRD_PARTY_LICENSES/`.
Licensed under [MIT](LICENSE).

## Install

Register the extension with Pi:

```sh
pi install npm:pipellm-pi-provider
```

Install the independent CLI or run it with npx:

```sh
npm install -g pipellm-pi-provider
pipellm-pi-provider --help
npx --yes pipellm-pi-provider --help
```

`pi install` registers the extension; `npm install` installs the CLI. Node.js 22+ is required.
Pi host packages are optional peers and are not bundled. Default commands use npm's `latest`;
use `pi install npm:pipellm-pi-provider@0.3.5` to pin a reproducible version. The package declares
`pi-package` for discovery in the [Pi gallery](https://pi.dev/packages).

Alternatively, install the compiled package from the latest GitHub Release:

```sh
curl -fL https://github.com/lwyBZss8924d/pipellm-pi-provider/releases/latest/download/pipellm-pi-provider-install.sh -o pipellm-pi-provider-install.sh && sh pipellm-pi-provider-install.sh
```

The script embeds the archive, verifies SHA-256, then calls `pi install`. Versioned assets and
`SHA256SUMS` are also available. After download, extraction needs POSIX sh, tar, base64 and
sha256sum or shasum. It installs under
`${XDG_DATA_HOME:-$HOME/.local/share}/pi-packages/pipellm-pi-provider`; keep this directory because
Pi loads it in place. Reinstallation uses the same registration path. Options: `--client pi-fork`,
`--package-command` for `CLIENT package install`, `--prefix DIR`, or `--extract-only DIR`.
The installed CLI is also runnable with `node /absolute/installed/directory/dist/cli.js`.
Restart Pi or use `/reload`.

## Configure and sign in

| Command           | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `/pipellm-config` | Set HTTPS gateway, model, token limits and thinking policy |
| `/pipellm-login`  | Validate hidden input and save it to macOS Keychain        |
| `/pipellm-status` | Show models and credential metadata                        |

Run those commands in order, then `/model pipellm/claude-sonnet-5-5` or your configured model.
Hidden input requires the terminal TUI; RPC clients use the CLI for login. Validation confirms
its destination/model and sends one small request before saving. The key is passed to `security`
on stdin, never argv, and the write is verified. Cancellation or failed validation saves no key.

A validated session key takes precedence, followed by `PIPELLM_API_KEY` in the environment and
Keychain items with that account name. Existing Keychain service labels are preserved when updating.
Configuration merges other providers/models, backs up existing bytes and atomically writes private
files. `models.json` holds a credential reference; this extension never reads or writes `auth.json`
and ignores its legacy credential. Use `/pipellm-login`; native `/login pipellm` directs you there.
Backups can contain older user-supplied secrets; keep them private.

**Do not save or inject `PIPELLM_API_KEY` through `.env` files.** Prefer Keychain on macOS;
otherwise use an authorized secret manager to inject only into the child process. The extension
never loads dotenv credentials. Startup, configuration and status check project/Pi agent directories
for assignments and loader indicators, reporting only fixed warnings and flags. Inspection covers
up to 32 regular `.env`/`.env.*` files and 64 KiB per file, skips symlinks/special files and reports
incomplete checks. Values/paths are not printed and files are not changed. Environment provenance
cannot be proven and is reported as unverified.

Pi supplies native Anthropic streaming and thinking behavior. With a gateway requiring adaptive
thinking, select `minimal` or higher: Pi `off` sends `disabled`, which such gateways reject.
New custom models have zero displayed cost estimates until you supply pricing in `models.json`.
Keychain persistence requires macOS; other platforms use the process environment.

## Management CLI

```sh
pipellm-pi-provider status --json
pipellm-pi-provider config show --json
pipellm-pi-provider config set --base-url https://cc-api.pipellm.ai/anthropic --model claude-sonnet-5-5 --dry-run --json
pipellm-pi-provider auth discover --json
pipellm-pi-provider auth policy --json
pipellm-pi-provider auth login --model claude-sonnet-5-5 --dry-run --json
pipellm-pi-provider auth login --model claude-sonnet-5-5 --yes
pipellm-pi-provider auth check --model claude-sonnet-5-5 --yes --json
pipellm-pi-provider doctor --json
```

Remove `--dry-run` to save configuration. Login accepts hidden terminal input, `--from-env` or
`--stdin`, never a key argument. Authorized agents may inject the key into the child and use
`auth login --from-env --yes --json`. `--yes` authorizes validation; only validated keys are saved.
`auth check` validates without saving. Authentication dry runs read no keys/dotenv contents and
send no request. `auth policy`, `status`, `auth discover` and `doctor` include dotenv-policy flags;
metadata operations never resolve Keychain passwords. Interactive login/check show the reminder.

Use `--agent-dir DIR` or `PI_CODING_AGENT_DIR` for isolated settings. Incur supports
`--schema --json`, `--llms --json`, field filters, JSON/JSONL, token limits, completions and opt-in
MCP/skill integration. Non-TTY output defaults to `{ ok, data/error, meta }` JSON envelopes.

## Compatibility and removal

Pi 1.0.2 is tested. Forks need Pi's JavaScript extension loader, native custom-provider API,
commands and TUI contracts; manifest metadata alone is insufficient. **Prime Agent 0.9.8 cannot
load this extension** because its TS/JS runtime was removed. The installer rejects clients without
advertised extension loading before changing settings/files. Prime can use its own model settings.

The default observer leaves requests/tools unchanged. It warns once per session for a returned
tool absent from the request, without blocking or logging payloads, headers, arguments or tool names.
Legacy fallback remains opt-in and needs Pi host helpers:

```sh
PIPELLM_COMPAT_MODELS=claude-opus-5-5 pi
```

Remove registration with `pi remove npm:pipellm-pi-provider` or
`pi remove /absolute/installed/directory`. Remove the CLI with `npm uninstall -g pipellm-pi-provider`.
Delete credentials separately in macOS Keychain Access.

## Develop and release

`src/` contains the extension, CLI and shared code; `scripts/` builds/releases; `tests/` holds
contracts and fixtures. `distribution/` contains canonical README/CLI-guide/workflow templates;
root copies stay aligned. Source `pi.extensions` points to TypeScript. The repository manifest is
private; packing creates a publishable compiled manifest with `bin`, `exports` and optional peers.

From the repository or the archive's `source/` directory:

```sh
bun install --frozen-lockfile --ignore-scripts
bun test tests
bun run typecheck
bun run format:check
bun run pack
sh dist/pipellm-pi-provider-install.sh
```

Build output includes the `.tgz`, stable/versioned installers and `SHA256SUMS`. CI tests Linux/macOS,
types, formatting and installations. Releases bind the version tag to its commit, verify checksums,
run the pinned [Codex Security SDK](https://learn.chatgpt.com/docs/security/sdk)
([source](https://github.com/openai/codex-security)), publish that tested
archive to npm `latest`, and upload GitHub assets. npm uses the repository's `NPM_TOKEN` secret.

Security scans use a dedicated maintainer-controlled self-hosted runner labelled
`codex-security-chatgpt`, with Node 24, Bun, Python 3.10+ and private `CODEX_HOME` outside the checkout.
Provision ChatGPT login with `codex login --device-auth`; verify `codex login status`. The SDK uses
`auth: "chatgpt"`. The SDK and native Codex CLI are pinned separately; the scanner uses the project's
CLI rather than the SDK's older bundled runtime. Select an account-supported model with the
`CODEX_SECURITY_MODEL` repository variable; the fallback is `gpt-6.1-sol` with high reasoning. Device login does not guarantee model
access. Pull requests run only on hosted runners without this login state.

Publication rejects scan errors, incomplete coverage/deferred review and high/critical findings.
Reports stay private under `$CODEX_HOME/pipellm-release-scans/`; see [SECURITY.md](SECURITY.md).
`bun scripts/security-scan.ts . --preflight` checks local inputs only; omit `--preflight` for a scan.

## Roadmap

Future iterations will support **1Password `op` storage, loading and automatic discovery** with
explicit vault/item selection. Current credential sources are Keychain and process environment.

Further reference: [Pi slash commands](https://pi.dev/docs/latest/slash-commands).
