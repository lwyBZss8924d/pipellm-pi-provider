# pipellm-pi-provider

MIT PipeLLM custom-provider extension for Pi, with compiled JavaScript, macOS Keychain
authentication, gateway setup, and an independent Incur CLI for humans and agents. The npm archive
includes corresponding sources and tests under `source/`, and bundled CLI dependency licenses under
`THIRD_PARTY_LICENSES/`.

## Install

Register the extension with Pi:

```sh
pi install npm:pipellm-pi-provider@0.3.1
```

Install the independent CLI, or run it without a global installation:

```sh
npm install -g pipellm-pi-provider@0.3.1
pipellm-pi-provider --help
npx --yes --package=pipellm-pi-provider@0.3.1 pipellm-pi-provider --help
```

The CLI requires Node.js 22+. `npm install` installs the CLI; `pi install` registers the extension.
Host Pi packages are optional peers and are not bundled.

You can also install directly from
[GitHub Releases](https://github.com/lwyBZss8924d/pipellm-pi-provider/releases):

```sh
curl -fL https://github.com/lwyBZss8924d/pipellm-pi-provider/releases/download/v0.3.1/pipellm-pi-provider-0.3.1-install.sh -o pipellm-pi-provider-0.3.1-install.sh && sh pipellm-pi-provider-0.3.1-install.sh
```

The installer embeds the `.tgz`, verifies its SHA-256 and delegates registration to `pi install`.
After download it needs only POSIX sh, tar, base64 and sha256sum or shasum. No npm, Bun or
TypeScript is needed. The permanent directory is
`${XDG_DATA_HOME:-$HOME/.local/share}/pi-packages/pipellm-pi-provider`; keep it because Pi loads
local packages in place. Reinstalling uses the same registration path. Use `--client pi-fork` for a
compatible executable, `--package-command` for `CLIENT package install`, `--prefix DIR` to choose
the directory, or `--extract-only DIR` for manual registration. The CLI remains runnable with
`node /absolute/installed/directory/dist/cli.js`.

Restart Pi or use `/reload` after installation.

## Configure and sign in from Pi

| Slash command     | Purpose                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `/pipellm-config` | Configure HTTPS gateway, model, context/output limits and thinking policy |
| `/pipellm-login`  | Enter a hidden key, validate it, then save to macOS Keychain              |
| `/pipellm-status` | Show models and credential availability without exposing keys             |

Run `/pipellm-config`, then `/pipellm-login`, then `/model pipellm/claude-sonnet-5-5` (or your
model). Existing `PIPELLM_API_KEY` environment values and Keychain items with that account name are
discovered automatically. A successful login is used for the current session; otherwise environment
takes precedence over Keychain. Existing Keychain service labels are preserved when a cached key is
updated.

The input is masked. Login confirms the destination/model, sends one minimal Anthropic Messages
request, saves only a valid key and verifies the Keychain write. The `security` subprocess receives
the key on stdin, never argv. Cancellation, validation failure or denied access does not save an
unvalidated key.

Models stay in the user's `models.json`. Setup merges other providers/models, backs up existing
bytes and atomically writes mode-0600 files. Authentication stores an environment/Keychain reference
rather than the key. This extension does not read or write `auth.json`, and ignores its legacy
credential when resolving PipeLLM authentication. Use `/pipellm-login`; `/login pipellm` reports
that instruction instead of using Pi's plaintext-key flow. Existing configuration backups may
contain older user-supplied values; keep them private. External model managers can replace the
parameters configured here.

Keychain persistence requires macOS. Other platforms can use `PIPELLM_API_KEY` in the environment.
Keys and payloads are never printed or shipped. New custom models use zero cost estimates until you
supply pricing in `models.json`; gateway billing is independent of the displayed estimate.

## Independent management CLI

```sh
pipellm-pi-provider status --json
pipellm-pi-provider config show --json
pipellm-pi-provider config set --base-url https://cc-api.pipellm.ai/anthropic --model claude-sonnet-5-5 --dry-run --json
pipellm-pi-provider config set --base-url https://cc-api.pipellm.ai/anthropic --model claude-sonnet-5-5
pipellm-pi-provider auth discover --json
pipellm-pi-provider auth login --model claude-sonnet-5-5 --dry-run --json
pipellm-pi-provider auth login --model claude-sonnet-5-5 --yes
pipellm-pi-provider auth check --model claude-sonnet-5-5 --yes --json
pipellm-pi-provider doctor --json
```

`auth login` accepts hidden terminal input, `--from-env` or `--stdin`; there is no key argument. For
authorized agents, inject `PIPELLM_API_KEY` into the child environment and use
`auth login --from-env --yes --json`. Never paste a key into arguments or a conversation. `--yes`
authorizes a validation request; dry runs send none and read no key. `auth check` does not write
credentials.

Use `--agent-dir DIR` or `PI_CODING_AGENT_DIR` for isolated configurations. Incur provides
`--schema --json`, `--llms --json`, field filters, JSON/JSONL, token limits, completion generation
and opt-in MCP/skill integration. Non-TTY output defaults to JSON envelopes with `ok`,
`data`/`error` and `meta`; terminal output remains readable.

## Compatibility and removal

Pi 1.0.2 is tested. Forks must retain Pi's **JavaScript extension loader, native custom-provider
API, command registration and TUI contracts**, rather than only `pi` manifest metadata. The optional
legacy fallback also needs Pi host mappings and tool helpers. **Prime Agent 0.9.8 cannot execute
this extension**: its Rust capability packages load skills, prompts and themes, and its TS/JS loader
was removed. The installer rejects clients without advertised extension loading before changing
files/settings. Prime can use PipeLLM via its own model settings.

Default model requests and tools are unchanged. An observer warns once per session for an assistant
tool call absent from the request, without blocking or logging payloads, headers, arguments or tool
names. Legacy fallback remains opt-in:

```sh
PIPELLM_COMPAT_MODELS=claude-opus-5-5 pi
```

Remove npm registration with `pi remove npm:pipellm-pi-provider`, or local registration with
`pi remove /absolute/installed/directory`. Remove the CLI with
`npm uninstall -g pipellm-pi-provider`. Manage credential deletion separately in macOS Keychain
Access.

## Build and release

The repository follows Pi's explicit `pi.extensions` convention for TypeScript
sources. The generated npm manifest points to compiled JavaScript instead.

```text
src/                 Extension, shared gateway/Keychain code, and CLI entry
scripts/             Compilation, license collection, and security release gate
tests/               Offline contracts, golden fixtures, and isolated installations
distribution/        Public documentation and standalone/workflow templates
.github/workflows/   CI and release pipelines
SECURITY.md          Security boundaries and private vulnerability reporting
```

The repository manifest is private to prevent publishing development files by
mistake. `bun run pack` creates a separate publishable manifest and a controlled
archive with optional host peers, `bin`, `exports`, source, and license notices.
Release workflows publish that exact tested archive. Formatter settings and
development tools are committed and pinned; `bun run format:check` checks style.

From the repository, or the archive's `source/` directory:

```sh
bun install --frozen-lockfile
bun test tests
bun run typecheck
bun run pack
```

`dist/` contains the compiled npm `.tgz`, standalone installer and `SHA256SUMS`. GitHub CI checks
Linux/macOS contracts, type checking and distribution installation. The release workflow builds the
exact version tag, runs the pinned Codex Security TypeScript SDK, publishes the compiled archive to
npm, and attaches these files to the matching GitHub Release. Publishing uses the repository's
`NPM_TOKEN` Actions secret; credentials never belong in source.

The security job requires a maintainer-controlled self-hosted runner labelled
`codex-security-chatgpt`, with Node 24, Bun and Python 3.10+, and `CODEX_HOME` set to a dedicated
login directory outside the checkout. Provision its login with `codex login --device-auth` and
verify `codex login status`. The SDK explicitly selects `auth: "chatgpt"`; no OpenAI API key or
copied login-file secret is needed. The scan model defaults to `gpt-6-sol` with high reasoning;
select another account-supported model with the `CODEX_SECURITY_MODEL` repository variable. Only
release tags on `main` and maintainer manual releases reach this runner. Pull requests run on
GitHub-hosted runners. Reauthenticate on the runner when required; keep the login directory private.
Device login does not establish access to every protected security model.

The gate refuses incomplete/error scans, incomplete coverage/deferred review, and high/critical
findings. Full reports stay on the runner and do not enter npm or GitHub release assets. See
[SECURITY.md](SECURITY.md). To inspect locally:

```sh
bun scripts/security-scan.ts . --preflight
bun scripts/security-scan.ts .
```

Preflight checks local inputs only; it is not a passed security scan. SDK workflow references were
learned from the upstream TypeScript SDK and GitHub Actions example at
[openai/codex-security](https://github.com/openai/codex-security).

## Roadmap

Future iterations will support **1Password `op` storage, loading and automatic discovery**, with
explicit vault/item selection and the same no-plaintext-key boundary. This release supports
environment discovery and macOS Keychain only.

References: [Pi packages](https://pi.dev/docs/latest/packages),
[custom providers](https://pi.dev/docs/latest/custom-provider),
[extensions](https://pi.dev/docs/latest/extensions),
[slash commands](https://pi.dev/docs/latest/slash-commands).
