# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
| < 0.1.0 | No        |

## Security model

`chrome-allow` is a local automation tool. While the watcher is **on**, it automatically approves Chrome's remote-debugging consent sheet. That means any local process that can reach Chrome's DevTools endpoint may obtain full control of the browser session, including cookies, saved data, navigation, and script execution.

This is intentional behavior, not a vulnerability:

- The endpoint is bound to `127.0.0.1` by Chrome.
- The watcher only runs after an explicit `chrome-allow on`, `once`, `run`, or `connect`.
- The watcher matches only the consent sheet titled 「要允许远程调试吗？」/「Allow remote debugging?」 and presses only 「允许」/`Allow`.
- Persistent mode can be limited with `--ttl`.
- Every click is logged to `~/.chrome-allow/watcher.log`.

Operational guidance:

- Run `chrome-allow off` as soon as the Chrome work is done.
- Do not enable persistent mode on shared or untrusted machines.
- Keep the Chrome debugging port on loopback.
- Review the audit log if unexpected approvals occur.

## Reporting a vulnerability

If you find a vulnerability, do **not** open a public issue. Use GitHub's private security advisory feature on the repository (Security → Report a vulnerability), or contact the maintainer through the repository profile.

Please include:

- Affected version
- macOS and Chrome versions
- Reproduction steps
- Impact assessment
- Whether Accessibility permission is required

## Out of scope

- Auto-approval while the watcher is intentionally enabled.
- Vulnerabilities in Chrome, macOS, or `chrome-devtools-mcp` itself.
- Attacks that already require local code execution with the user's privileges.
- Social engineering.
