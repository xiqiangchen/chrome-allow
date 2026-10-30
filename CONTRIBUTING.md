# Contributing

Thanks for helping improve `chrome-allow`.

## Prerequisites

- macOS (Apple Silicon or Intel)
- Node.js >= 18
- Xcode Command Line Tools (`xcrun swiftc`)
- Google Chrome

No runtime npm dependencies are used; keep it that way unless there is a strong reason.

## Setup

```bash
git clone <repo>
cd chrome-dev-auto-allow
npm run build:watcher   # builds watchers/chrome-allow-watcher (gitignored)
npm link                # exposes the `chrome-allow` command
npm run check
chrome-allow doctor
```

## Project layout

```
bin/chrome-allow.js                     CLI, state, process management
watchers/watcher.swift                  native AX watcher
watchers/chrome-allow-watcher           universal binary (committed)
watchers/allow-watcher.applescript      AppleScript fallback
skills/chrome-allow/SKILL.md            Claude Code skill
```

## Build the watcher

```bash
npm run build:watcher
```

This runs `scripts/build-watcher.sh`, which compiles arm64 and x86_64 slices, merges them with `lipo`, and ad-hoc signs the result. The output is `watchers/chrome-allow-watcher`, which is **gitignored**: it is a build artifact, not source.

`npm publish` runs `prepublishOnly`, which rebuilds the binary, so the npm tarball still ships a universal binary even though it is not in git.

## Test

Safe checks (do not click anything):

```bash
node --check bin/chrome-allow.js
osacompile -o /tmp/watcher.scpt watchers/allow-watcher.applescript
chrome-allow status
chrome-allow doctor
chrome-allow on --ttl 5
chrome-allow status
chrome-allow off
```

End-to-end (requires Chrome with `chrome://inspect#remote-debugging` enabled and Accessibility permission):

```bash
chrome-allow on
node /tmp/cdp-connect-test.js 20   # any script that opens 20 CDP connections
chrome-allow off
```

The watcher auto-approves each connection. Confirm 20/20 and check `~/.chrome-allow/watcher.log`.

## Code guidelines

- CommonJS, no runtime dependencies, Node >= 18.
- Keep the watcher dependency-free and event/poll based; never use `activate` or focus-stealing UI scripting.
- Match only the exact consent sheet title and only the 「允许」/`Allow` button.
- Maintain the 1.5 s debounce.
- Update `README.md` and `README-CN.md` together.
- Add user-visible changes to `CHANGELOG.md`.
- Do not commit tokens, logs, or `node_modules`.

## Pull requests

Before opening a PR:

```bash
npm run check
npm pack --dry-run
```

Include:

- What changed and why.
- Test environment (macOS version, Chrome version, Intel/Apple Silicon).
- Whether the universal binary was rebuilt.
- Any security implications.

## Release

```bash
npm version patch --no-git-tag-version
npm publish
npm view chrome-allow dist-tags versions --registry=https://registry.npmjs.org/
```

Notes:

- The package is macOS-only; `prepublishOnly` verifies the universal binary.
- npm may take 10–15 minutes to expose a version that contains a native binary. Do not assume failure immediately.
- Verify from a clean prefix:
  ```bash
  npm install -g --prefix /tmp/chrome-allow-test chrome-allow@<version>
  /tmp/chrome-allow-test/bin/chrome-allow --version
  ```
