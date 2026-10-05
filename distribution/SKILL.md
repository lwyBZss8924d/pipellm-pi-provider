---
name: pipellm-pi-provider
description: Manage PipeLLM Pi gateway configuration and macOS Keychain credentials with the
  pipellm-pi-provider CLI.
---

Discover commands with `pipellm-pi-provider --llms --json`; inspect inputs with
`pipellm-pi-provider config set --schema --json`. Use JSON and field filters for bounded output.
`status`, `config show`, `auth discover` and `doctor` send no gateway request and do not resolve
Keychain passwords. Credential metadata commands also report dotenv-policy flags.

Preview authorized changes with `config set --dry-run --json`. Select the intended installation with
`--agent-dir` or `PI_CODING_AGENT_DIR`. Writes preserve other provider/model entries and back up
existing bytes.

Never put a key in arguments, prompts, files or output. Authorized automation may inject
PIPELLM_API_KEY into a child and use `auth login --from-env --yes`. Humans use `/pipellm-login` or
hidden CLI terminal input. `auth login --dry-run` reads no key and sends no request. `--yes`
authorizes validation; only a valid key is saved to Keychain. `auth check --yes` validates without
saving. Live operations require user authorization.

Never save or inject PIPELLM_API_KEY through .env files. Use macOS Keychain or a secret manager
injecting only into the authorized child process. `auth policy --json` checks bounded regular
dotenv files for the variable name and reports fixed warnings and flags, never values or paths.
The extension warns at Pi startup and on status/configuration. Environment provenance is
unverified; loader indicators do not prove the source of a particular key. Symlinks, special files
and inspection limits are reported as incomplete. Authentication dry runs inspect no dotenv content.

Pi registration is separate from CLI installation: `pi install npm:pipellm-pi-provider`. Compatible
forks need the native Pi extension API; current Prime cannot load JS extensions. 1Password op
integration is planned, not implemented.
