---
name: pipellm-pi-provider
description: Configure the PipeLLM Pi provider and manage macOS Keychain credentials with its CLI.
---

Discover commands with `pipellm-pi-provider --llms --json` and inputs with
`pipellm-pi-provider config set --schema --json`. Use JSON and field filters for bounded output.
`status`, `config show`, `auth discover`, `auth policy` and `doctor` send no gateway request and
never resolve Keychain passwords. Credential metadata includes dotenv-policy flags.

Preview configuration with `config set --dry-run --json`; select settings with `--agent-dir`
or `PI_CODING_AGENT_DIR`. Authorized writes merge other models/providers and back up existing bytes.
Register the extension separately with `pi install npm:pipellm-pi-provider`.

Never put keys in arguments, prompts, output or dotenv files. Prefer macOS Keychain; authorized
agents may inject `PIPELLM_API_KEY` into a child and use `auth login --from-env --yes --json`.
Humans use hidden CLI input or `/pipellm-login` in Pi's terminal TUI. `--yes` authorizes one small
validation request; only validated keys are saved. `auth check --yes` validates without saving.
Authentication dry runs read no key/dotenv contents and send no request. Live operations and
credential writes require authorization from the active task.

`auth policy --json` detects bounded regular-file assignments and dotenv loader indicators;
output contains fixed warnings and flags, never values/paths. Checks do not modify files and
cannot prove environment provenance. Incomplete inspection is reported.

Pi 1.0.2 and 1.0.3 are tested. Compatible forks require its native extension/provider/command/TUI APIs;
Prime Agent 0.9.8 cannot load JS extensions. Gateways requiring adaptive thinking need `minimal`
or higher. 1Password storage/loading/discovery is planned, not implemented.
