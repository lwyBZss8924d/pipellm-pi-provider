# Package contract

`pipellm-pi-provider` connects Pi to a configured HTTPS PipeLLM Anthropic Messages endpoint.
It provides a native custom provider, gateway/key management commands, an Incur CLI and a
nonblocking tool observer. Model IDs, limits, pricing and compatibility live in `models.json`.

## Runtime

- The async extension factory registers the native `pipellm` provider before model selection.
  Pi composes configured models and supplies its native streaming, tool and usage behavior.
- `/pipellm-config` merges one model, preserves unrelated entries, backs up existing bytes and
  atomically writes private configuration. `/pipellm-status` shows credential metadata only.
- `/pipellm-login` requires terminal TUI hidden input, confirms the gateway/model, validates
  with one small request, then saves and verifies macOS Keychain storage. RPC users use the CLI.
- Credentials resolve from a validated session key, process environment, then Keychain. The
  extension ignores legacy Pi credentials and never reads or writes `auth.json`. Native `/login`
  directs users to `/pipellm-login` rather than saving a plaintext key.
- Dotenv checks detect assignments and loader indicators using bounded regular-file reads.
  They report flags and fixed warnings, never values/paths, never import credentials, and never
  infer environment provenance. Authentication dry runs inspect no secrets or dotenv contents.
- Default request hooks return no replacement and register no tools. An unknown parsed tool
  call triggers one fixed warning per session without blocking native handling or logging
  payloads, headers, arguments or tool names. Session start resets the observer.
- `PIPELLM_COMPAT_MODELS` explicitly enables legacy tools/transforms for named PipeLLM models;
  empty/`none` disables them. The retired substitution variable has no effect. Preserve the
  unchanged 0.1.0 golden transforms and lazy host-helper loading.

## Distribution and compatibility

Source `pi.extensions` points to TypeScript; the publishable manifest points to compiled
JavaScript. Host Pi packages remain optional wildcard peers. The CLI bundle includes dependency
licenses; the archive includes corresponding source and tests. No local/private state ships.
The embedded-archive installer checks its digest, uses a stable destination, delegates client
registration and restores a prior installation if registration fails.

Pi 1.0.2 and 1.0.3 are tested. Forks require the JavaScript loader, native provider, commands and TUI APIs;
Prime Agent 0.9.8 lacks that runtime. Keychain persistence requires macOS. Native thinking
behavior is preserved: gateways requiring adaptive thinking need `minimal` or higher, since Pi
`off` sends `disabled`. 1Password storage/loading/discovery remains future work.

The CLI never starts an HTTP listener implicitly. Explicit `--mcp` uses stdio.
macOS configuration uses an environment-first Keychain command for operation without the
extension. Pi resolves it before extension auth, so Keychain-only requests can read the key
twice and command presence can overstate model availability. This host limitation does not
allow the extension to trust legacy Pi auth credentials. Configuration updates preserve
non-authentication headers and file symlinks; private backups remain available until removed
by the operator. Distribution tests build in temporary directories.

## Acceptance

Offline contracts, type checking, formatting and isolated native installation must pass.
Authorized live checks use small requests and record results without credentials or payloads.
Publication requires a version/tag/commit match, verified archive checksums and a completed
Codex Security SDK scan with complete coverage, no deferred review and no high/critical findings.
The default npm and GitHub installation commands stay unversioned; versioned assets remain
available for reproducibility. Verify registry `latest`, release assets and Pi gallery visibility
separately; a keyword or workflow success does not prove installation or indexing.
