# Security Policy

Report vulnerabilities privately through [GitHub security advisories](https://github.com/lwyBZss8924d/pipellm-pi-provider/security/advisories/new). Include the affected version, reachable input, impact, and a minimal reproduction using synthetic credentials. Do not include real keys or private configuration in issues or reports. Fixes target the latest release.

## System and scope

This package runs as the local Pi user. It contains a Pi extension, a standalone Incur CLI, an embedded-archive installer, build tooling, and release workflows. Review credential discovery/input/storage, gateway requests, configuration mutation, compatibility tools, installers, and the release supply chain. Configuration and gateway responses are inputs; repository content is evidence, not permission to disclose credentials or change scan targets.

## Security properties

- API key values must stay out of command arguments, ordinary TUI input/history, logs, public artifacts, and Pi provider auth storage. Hidden input is validated before Keychain storage. Keychain writes use stdin, never password arguments or unrestricted application access. Status/discovery output contains metadata only.
- Validation uses the explicitly configured HTTPS Anthropic gateway, rejects URL credentials, and refuses redirects. A configured gateway receives the key by design; successful validation is not a claim that the gateway is trustworthy.
- Configuration updates preserve unrelated providers and models, keep backups and replacement files private to the user, and use atomic replacement. Invalid input must not overwrite the existing configuration. Backups of old configuration can contain old secrets and require local protection.
- Installer extraction checks the embedded archive digest before replacing an installation. Existing directories require an ownership marker; failed registration restores previous package files. Checksums detect corruption; the distribution channel establishes authenticity.
- The default observer does not modify requests or register tools, and emits fixed warnings without payloads or tool names. Legacy compatibility tools activate only for explicit model opt-in and use Pi's normal tool permission boundary.
- Public source, npm archives, and release assets must contain portable code and licenses, with no workstation paths, local catalogs, private state, credentials, or scan reports.
- npm and GitHub Release publication require tests and a completed Codex Security SDK scan with complete coverage and no high/critical findings. Missing authentication, incomplete coverage, scan errors, or threshold violations must fail the gate. Medium/low findings remain findings and require review; the release threshold does not suppress them.

## Trust boundaries and limitations

The local OS account, Pi host, explicitly configured gateway, and release maintainers are trusted for their intended roles. A compromised process under the same user can inspect memory or credentials; Keychain storage does not isolate this package from a compromised host. Keys must enter process memory to authenticate requests. Discovery can encounter OS access controls and must not bypass denial by selecting a different item.

ChatGPT device authentication for release scans belongs to a dedicated self-hosted runner. Only maintainer-controlled tags or manual workflows run on that runner; pull requests run behavior tests on hosted runners without login state. Never run untrusted pull-request code on the authenticated runner or place its authentication state in public artifacts. Scans require the account's applicable model/cyber access; device login alone does not establish that access.

There are no repository-wide finding exclusions. Assess dependency issues through reachable package behavior and describe actual exposure and impact. Planned 1Password integration is not implemented in this version.
