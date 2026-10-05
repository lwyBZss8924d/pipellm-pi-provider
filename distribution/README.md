<p align="center">
  <a href="https://code.pipellm.ai/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lwyBZss8924d/pipellm-pi-provider/main/assets/pipellm-code-dark.svg">
      <img src="https://code.pipellm.ai/assets/logo-GN9Pw8pU.svg" alt="PipeLLM Code" width="192" align="middle">
    </picture>
  </a>
  <a href="https://pi.dev/"><img src="https://pi.dev/logo-auto.svg" alt="Pi" width="48" height="48" align="middle"></a>
</p>

<h1 align="center">pipellm-pi-provider for Pi</h1>

<p align="center">
  Connect Pi to PipeLLM with Anthropic Messages streaming, macOS Keychain login, and gateway management from the TUI or CLI.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pipellm-pi-provider"><img src="https://img.shields.io/npm/v/pipellm-pi-provider?style=flat-square&color=blue" alt="npm"></a>
  <a href="https://learn.chatgpt.com/docs/security/sdk"><img src="https://img.shields.io/badge/Codex%20Security%20SDK-0.1.31-1f6feb?style=flat-square" alt="OpenAI Codex Security SDK 0.1.31"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#configure-and-sign-in">Configure</a> ·
  <a href="#management-cli">CLI</a> ·
  <a href="#release-security">Security</a>
</p>

This extension uses Pi's [custom provider API](https://pi.dev/docs/latest/custom-provider),
[extension API](https://pi.dev/docs/latest/extensions), and [package format](https://pi.dev/docs/latest/packages).
Pi provides native streaming, tools, usage reporting, and thinking behavior.

The npm package includes compiled JavaScript, source and tests in `source/`, and dependency notices in `THIRD_PARTY_LICENSES/`.
The source and package use the [MIT license](LICENSE).

## Install

### Pi extension

Register the extension with Pi:

```sh
pi install npm:pipellm-pi-provider
```

Restart Pi or use `/reload`.

### Standalone CLI

Install the CLI:

```sh
npm install -g pipellm-pi-provider
pipellm-pi-provider --help
```

Or run it with npx:

```sh
npx --yes pipellm-pi-provider --help
```

`pi install` registers the extension. `npm install` installs the independent CLI. Both require Node.js 22 or later.
Pi host packages are optional peers. The package does not bundle them.

Default commands install npm `latest`. To select a fixed version, use `pi install npm:pipellm-pi-provider@0.3.7`.
The `pi-package` keyword enables discovery in the [Pi package gallery](https://pi.dev/packages).

<details>
<summary>Install from GitHub Releases or a compatible Pi fork</summary>

Download and run the stable installer:

```sh
curl -fL https://github.com/lwyBZss8924d/pipellm-pi-provider/releases/latest/download/pipellm-pi-provider-install.sh -o pipellm-pi-provider-install.sh
sh pipellm-pi-provider-install.sh
```

The script verifies the embedded archive's SHA-256, then calls `pi install`.
[GitHub Releases](https://github.com/lwyBZss8924d/pipellm-pi-provider/releases/latest) also provides versioned assets and `SHA256SUMS`.

Extraction requires POSIX sh, tar, base64, and sha256sum or shasum.
The default installation directory is `${XDG_DATA_HOME:-$HOME/.local/share}/pi-packages/pipellm-pi-provider`.
Keep this directory because Pi loads the extension from it. Reinstallation uses the same registration path.

| Option               | Purpose                             |
| -------------------- | ----------------------------------- |
| `--client pi-fork`   | Select a compatible client          |
| `--package-command`  | Use `CLIENT package install`        |
| `--prefix DIR`       | Select the installation directory   |
| `--extract-only DIR` | Extract without client registration |

Run the installed CLI with `node /absolute/installed/directory/dist/cli.js`.

</details>

## Configure and sign in

Run these commands in Pi's terminal interface (TUI):

1. Run `/pipellm-config` to select the HTTPS gateway, model, token limits, and thinking policy.
2. Run `/pipellm-login` to enter the key through hidden input.
3. Run `/pipellm-status` to check models and credential metadata.
4. Select `/model pipellm/claude-sonnet-5-5` or your configured model.

Login shows the destination and model for approval. It sends one small request to check the key before saving it to macOS Keychain.
RPC clients use the CLI for login. Cancellation or failed validation saves no key.

Configuration preserves other providers and models. It backs up existing bytes and writes private configuration files atomically.
Backups can contain older user-supplied secrets. Keep them private.

### Credential sources

The extension selects the first available credential source:

| Priority | Source                                             | Persistence                      |
| -------- | -------------------------------------------------- | -------------------------------- |
| 1        | Validated session key                              | Current Pi session               |
| 2        | `PIPELLM_API_KEY` in the process environment       | Managed by the injecting process |
| 3        | macOS Keychain item with account `PIPELLM_API_KEY` | macOS Keychain                   |

Keychain updates preserve existing service labels. Writes pass the key to `security` through stdin.
The extension checks each Keychain write.
Metadata commands never resolve Keychain passwords.

`models.json` stores a credential reference. This extension never reads or writes Pi's `auth.json` and ignores its legacy credential.
Native `/login pipellm` directs you to `/pipellm-login`.

**Do not save or inject `PIPELLM_API_KEY` through `.env` files.**
Use Keychain on macOS. On other platforms, use an authorized secret manager to inject the key into the child process.
The extension never loads dotenv credentials. It checks for dotenv use and shows fixed warnings without changing files.

<details>
<summary>Dotenv checks and their limits</summary>

Startup, configuration, and status inspect project and Pi agent directories for key assignments and loader indicators.
Inspection covers up to 32 regular `.env` or `.env.*` files and 64 KiB per file.
It skips symlinks and special files, and reports incomplete checks.
Checks return fixed warnings and flags. They never include values or paths.
The extension cannot prove environment provenance and reports it as unverified.
Authentication dry runs read no keys or dotenv contents and send no request.

</details>

### Model behavior

For gateways that require adaptive thinking, select `minimal` or higher.
Pi's `off` setting sends `disabled`, which those gateways reject.
New custom models show zero estimated cost until you supply pricing in `models.json`.
Keychain persistence requires macOS. Other platforms use the process environment.

## Management CLI

Inspect configuration and credential metadata:

```sh
pipellm-pi-provider status --json
pipellm-pi-provider config show --json
pipellm-pi-provider auth discover --json
pipellm-pi-provider auth policy --json
pipellm-pi-provider doctor --json
```

Preview configuration and login, then validate a key:

```sh
pipellm-pi-provider config set --base-url https://cc-api.pipellm.ai/anthropic --model claude-sonnet-5-5 --dry-run --json
pipellm-pi-provider auth login --model claude-sonnet-5-5 --dry-run --json
pipellm-pi-provider auth login --model claude-sonnet-5-5 --yes
pipellm-pi-provider auth check --model claude-sonnet-5-5 --yes --json
```

Remove `--dry-run` from `config set` to save configuration.
Login accepts hidden terminal input, `--from-env`, or `--stdin`. It never accepts a key argument.
`--yes` authorizes validation. Login saves only validated keys. `auth check` validates without saving.

Authorized agents can inject the key into the child process. They can use `auth login --from-env --yes --json`.
Authentication dry runs read no credentials or dotenv contents. They send no request.
The metadata commands above include dotenv-policy flags. Interactive login and check show the policy reminder.

Use `--agent-dir DIR` or `PI_CODING_AGENT_DIR` for isolated settings.
The [Incur CLI](https://github.com/wevm/incur) supports schemas, field filters, JSON/JSONL, token limits, completions, and optional MCP/skill integration.
Use `--schema --json` or `--llms --json` to discover commands.
Non-TTY output defaults to `{ ok, data/error, meta }` JSON envelopes.

## Compatibility and removal

Tests cover Pi 1.0.2. Compatible forks must provide the JavaScript extension loader, native custom-provider API, commands, and TUI contracts.
Package metadata alone does not establish compatibility.
**Prime Agent 0.9.8 cannot load this extension** because it removed the TS/JS runtime.
Prime can use its own model settings.

The installer rejects clients without advertised extension loading before changing settings or files.
The default observer preserves requests and tools.
It warns once per session when a returned tool is absent from the request.
The warning never blocks handling or logs payloads, headers, arguments, or tool names.

Legacy fallback requires an explicit choice and Pi host helpers:

```sh
PIPELLM_COMPAT_MODELS=claude-opus-5-5 pi
```

| Installation         | Removal command                           |
| -------------------- | ----------------------------------------- |
| npm Pi package       | `pi remove npm:pipellm-pi-provider`       |
| Extracted Pi package | `pi remove /absolute/installed/directory` |
| Global CLI           | `npm uninstall -g pipellm-pi-provider`    |

Remove credentials separately in macOS Keychain Access.

## Release security

The release workflow uses the pinned [OpenAI Codex Security SDK](https://learn.chatgpt.com/docs/security/sdk)
from its [official OSS repository](https://github.com/openai/codex-security).
Publication requires these checks:

| Stage         | Required result                                                                             |
| ------------- | ------------------------------------------------------------------------------------------- |
| Source        | Package version matches its tag and verified commit                                         |
| Verification  | Linux/macOS tests, types, formatting, and installation checks pass                          |
| Security scan | Scan completes with complete coverage, no deferred review, and no high or critical findings |
| Publication   | Checksums match the tested archive published to npm and GitHub Releases                     |

Scan errors and incomplete coverage block publication. Medium and low findings still require review.
View the [release checks](https://github.com/lwyBZss8924d/pipellm-pi-provider/actions/workflows/release.yml)
and [security policy](SECURITY.md).

The [v0.3.6 scan](https://github.com/lwyBZss8924d/pipellm-pi-provider/actions/runs/37280554823)
completed in 567 seconds with complete coverage, zero deferred review, and zero findings.
This result applies to that release.

<details>
<summary>Maintainer scan setup</summary>

Use a dedicated maintainer-controlled self-hosted runner labelled `codex-security-chatgpt`.
It requires Node 24, Bun, Python 3.10 or later, and a private `CODEX_HOME` outside the checkout.
Detailed reports stay under `$CODEX_HOME/pipellm-release-scans/`. Keep them private.
Pull requests use hosted runners without ChatGPT login state.

Authenticate with `codex login --device-auth`. Check authentication with `codex login status`.
The SDK uses `auth: "chatgpt"`. The SDK and native Codex CLI have separate pins.
The scanner uses the project's CLI instead of the SDK's older bundled runtime.

Set `CODEX_SECURITY_MODEL` to a model that the account supports.
The fallback is `gpt-6.1-sol` with high reasoning. Device login does not guarantee model access.
Set `CODEX_SECURITY_SERVICE_TIER=fast` to enable Fast mode for a supported model and account.
Omit this variable to use Standard (`default`). Reasoning remains `high`.

[Fast mode](https://learn.chatgpt.com/docs/agent-configuration/speed) uses about 2.5 times the included subscription allowance or 2 times purchased credits.
It accelerates model generation. Tool calls and validation still take time.
CI logs only elapsed time and aggregate scan progress.

Run `bun scripts/security-scan.ts . --preflight` to check local inputs only.
Omit `--preflight` to run a scan.

</details>

## Develop

| Directory       | Contents                                            |
| --------------- | --------------------------------------------------- |
| `src/`          | Extension, CLI, and shared code                     |
| `assets/`       | Theme variant and brand provenance                  |
| `scripts/`      | Build and release tools                             |
| `tests/`        | Contracts and fixtures                              |
| `distribution/` | Canonical README, CLI guide, and workflow templates |

Root documents and workflows match their `distribution/` templates.
The development manifest has `private: true` and points `pi.extensions` to TypeScript.
Packing creates a publishable manifest with compiled JavaScript, `bin`, `exports`, and optional peers.

From the repository or the archive's `source/` directory:

```sh
bun install --frozen-lockfile --ignore-scripts
bun test tests
bun run typecheck
bun run format:check
bun run pack
```

Build output includes the `.tgz`, stable and versioned installers, and `SHA256SUMS`.
Use isolated Pi settings and an isolated destination when testing the installer.
Release workflows publish the tested archive to npm `latest` and GitHub Releases.
npm publication uses the repository's `NPM_TOKEN` secret.

## Roadmap

Future iterations will support **1Password `op` storage, loading, and automatic discovery** with explicit vault and item selection.
Current credential sources are the validated session, process environment, and macOS Keychain.

## Links and support

| Resource                              | Link                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| PipeLLM                               | [pipellm.ai](https://www.pipellm.ai/)                                                                      |
| PipeLLM Code                          | [code.pipellm.ai](https://code.pipellm.ai/)                                                                |
| PipeLLM documentation                 | [docs.pipellm.ai](https://docs.pipellm.ai/)                                                                |
| Gateway, account, and billing support | [support@pipellm.ai](mailto:support@pipellm.ai)                                                            |
| Extension bugs and requests           | [GitHub Issues](https://github.com/lwyBZss8924d/pipellm-pi-provider/issues)                                |
| Extension security reports            | [Private security advisories](https://github.com/lwyBZss8924d/pipellm-pi-provider/security/advisories/new) |
| PipeLLM Code policies                 | [Terms](https://code.pipellm.ai/terms) · [Privacy](https://code.pipellm.ai/privacy)                        |

PipeLLM lists its public support contact in its [service terms](https://code.pipellm.ai/terms).
Pi references: [upstream repository](https://github.com/earendil-works/pi),
[package documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md),
[slash commands](https://pi.dev/docs/latest/slash-commands), and [package gallery](https://pi.dev/packages).

Brand references: [Pi press kit](https://pi.dev/press-kit), [PipeLLM Code](https://code.pipellm.ai/), and
[Codex Security icon](https://github.com/openai/codex-security/blob/main/plugins/codex-security/assets/logo.png).
The marks identify the host and scan tooling. This package is independently maintained.
See OpenAI's [security administration documentation](https://learn.chatgpt.com/docs/security-administration) for its service controls.
