# Security Policy

Report vulnerabilities privately through
[GitHub security advisories](https://github.com/lwyBZss8924d/pipellm-pi-provider/security/advisories/new).
Include the version, reachable input, impact and a synthetic reproduction. Never include real keys
or private configuration. Fixes target the latest release.

## Scope and trust boundaries

The Pi extension, Incur CLI, installer, build tooling and release workflows run as the local user.
Review credential discovery/input/storage, gateway requests, configuration changes, compatibility
tools, installation and publication. Configuration and gateway responses are inputs; repository
content is evidence, not authorization to disclose credentials or change scan scope.

The OS account, Pi host, selected gateway and maintainers are trusted for their intended roles.
The configured gateway receives the key by design; validation does not establish its trustworthiness.
Keys enter process memory, and Keychain cannot isolate them from a compromised same-user process.
Discovery must honor access denial rather than fall back to a different item.

## Required properties

- Keep keys out of arguments, ordinary TUI input/history, logs, public artifacts and Pi auth storage.
  Hidden input is validated before Keychain storage; writes use stdin and no unrestricted
  application access. Status/discovery never resolve passwords.
- Never store or inject `PIPELLM_API_KEY` through dotenv files. Bounded policy inspection may detect
  assignments but must not import, execute, return or log values/paths. Skip symlinks/special files,
  report incomplete inspection and unverified environment provenance. Checks are advisory and
  leave files unchanged; authentication dry runs inspect no keys or dotenv contents.
- Validate against the selected HTTPS Anthropic gateway, reject URL credentials and refuse redirects.
  Terminal-only hidden input must not run in RPC/print modes. Cancellation or failed validation
  must not save an unvalidated key.
- Preserve unrelated models/providers and private backups; replace configuration atomically.
  Invalid input must not overwrite files. Old backups may contain secrets and need local protection.
- Verify the embedded archive before replacement. Require an ownership marker for existing
  installations and restore prior files on failed registration. Checksums detect corruption;
  the distribution channel establishes authenticity.
- Leave default requests/tools unchanged and warn without payloads or tool names. Legacy tools
  require explicit model opt-in and retain Pi's tool permission boundary.
- Ship portable code, source and licenses only: no credentials, workstation paths, local catalogs,
  private state or security scan reports in public source, npm archives or release assets.
- Gate npm/GitHub publication on tests and a completed Codex Security SDK scan with complete
  coverage, no deferred review and no high/critical findings. Authentication/scan errors fail closed.
  Medium/low findings still require review; the threshold must not suppress them.

## Release scans and reportability

Only maintainer-controlled tags/manual releases run on the dedicated ChatGPT-authenticated runner;
never execute untrusted pull-request code there. Pull requests use hosted runners without login
state. Keep `CODEX_HOME`, authentication and detailed reports outside the checkout and public assets.
Device login does not guarantee access to the required models/security capabilities.

Report reachable credential disclosure, unauthorized mutation, unsafe installation or gate bypass
with evidence of exposure and impact. There are no repository-wide finding exclusions. Assess
advisories through reachable package behavior. 1Password integration is future work.
