# Agent instructions

Read [SPEC.md](SPEC.md) for behavior and [SECURITY.md](SECURITY.md) for security boundaries.
Use [llms.txt](llms.txt) to find the relevant entry point. Preserve unrelated changes.

- Register the native provider in the extension factory. Delegate Anthropic Messages streaming
  to Pi; model definitions stay in `models.json`.
- Keep the default observer nonblocking: no request replacements, extra tools, or payload logs.
  Preserve the opt-in 0.1.0 compatibility fixtures.
- Never read `auth.json`, print credentials, or put keys in arguments or dotenv files. Hidden
  input must validate before Keychain storage. Metadata commands never resolve passwords.
- Keep source and distribution portable. Exclude local configuration, private records and
  workstation paths. Inspect both the repository and the packed payload before release.
- Keep root `README.md`/`SKILL.md` and workflows equal to their `distribution/` templates.
  Default installation examples use npm `latest` or the stable GitHub installer URL.
- Gateway calls, credential writes and publication need authorization from the active task.
  Use isolated configurations for installation tests; do not modify the user's Pi settings.

For source changes run:

```sh
bun install --frozen-lockfile --ignore-scripts
bun test tests
bun run typecheck
bun run format:check
git diff --check
```

`bun run pack` produces the publishable archive; never publish the private development manifest.
Release only the tested archive after a complete Codex Security SDK scan passes the gate.
Report the revision, actual validation, artifacts and unresolved limitations. A successful
process or checkpoint alone is not task acceptance.
