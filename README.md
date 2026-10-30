# chrome-allow

**English** | [简体中文](README-CN.md)

[![npm version](https://img.shields.io/npm/v/chrome-allow.svg)](https://www.npmjs.com/package/chrome-allow)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](#requirements)

Zero-touch approval for Chrome's native 「Allow remote debugging?」 consent sheet.

Keep using your real, logged-in Chrome. No focus stealing. Explicit `on` / `off` lifecycle, one-shot mode, and a Claude Code skill.

## Why this exists

Chrome 136+ no longer honors `--remote-debugging-port` when using the default user data directory. The supported path is the `chrome://inspect#remote-debugging` toggle, which starts the DevTools server in approval mode:

> In approval mode, each incoming connection needs to be approved by the user.

There is no preference, enterprise policy, or "remember this client" option that suppresses the sheet. Every new CDP connection asks again. That makes headless agent workflows impossible without either:

1. a dedicated non-default profile (different Chrome session, not your logged-in one), or
2. something that answers the sheet.

Typical scenario: while building crawlers or reconstructing a site with Codex and Claude Code (including REA-style reverse-engineering workflows), every Chrome DevTools call opens the consent sheet. If nobody clicks it, the task stalls — especially painful for long autonomous runs and repeated reconnects.

`chrome-allow` is option 2, with an explicit lifecycle.

## How it works

```
chrome-allow on
  └─ spawns watchers/chrome-allow-watcher (Swift, universal binary)
       ├─ AXUIElementCreateApplication("com.google.Chrome")
       ├─ kAXWindowsAttribute → AXSheets
       ├─ match sheet title: 远程调试 / remote debugging
       ├─ recursively find AXButton titled 允许 / Allow
       ├─ AXUIElementPerformAction(kAXPressAction)
       └─ append "clicked" to ~/.chrome-allow/last-result.log
```

Key properties:

- **No focus stealing.** No `activate`, no `System Events` UI scripting.
- **Exact match.** Only the remote-debugging consent sheet; only 「允许」/`Allow`.
- **Never clicks** 「取消」 or 「在设置中关闭」.
- **Debounced.** 1.5 s cooldown prevents repeated presses on a stale sheet.
- **Audited.** Every click is written to `~/.chrome-allow/watcher.log`.
- **Fallback.** If the native binary is missing, the AppleScript watcher is used. It is unreliable on background Chrome windows and should be treated as a last resort.

Measured on Chrome 156 with 20 sequential CDP connections: **20/20 approved**, average 1.57 s per connection.

## Install

```bash
npm install -g chrome-allow
chrome-allow doctor
chrome-allow install-skill        # install the Claude Code skill into ~/.claude/skills
```

`install-skill --project` installs into `./.claude/skills` instead. Restart Claude Code to load the skill.

From source:

```bash
git clone <repo>
cd chrome-dev-auto-allow
npm run build:watcher   # requires Xcode Command Line Tools
npm link
chrome-allow doctor
```

## Quick start

1. Enable the Chrome toggle once: open `chrome://inspect#remote-debugging` and turn on remote debugging.
2. Check environment:

   ```bash
   chrome-allow doctor
   ```

3. Start the watcher, then trigger the connection:

   ```bash
   chrome-allow on
   chrome-allow connect
   ```

4. When done:

   ```bash
   chrome-allow off
   chrome-allow status
   ```

## Commands

| Command | Purpose |
|---------|---------|
| `chrome-allow status [--json]` | Chrome, toggle, endpoint, watcher, Accessibility state |
| `chrome-allow on [--ttl <sec>]` | Persistent watcher until `off` or TTL expiry |
| `chrome-allow off` | Stop the persistent watcher |
| `chrome-allow once [--timeout <sec>] [--wait] [--json]` | One-shot watcher; default 30 s |
| `chrome-allow run [--timeout <sec>] -- <cmd...>` | One-shot watcher around a command |
| `chrome-allow connect [--timeout <sec>]` | Start `chrome-devtools` CLI and list pages |
| `chrome-allow endpoint` | Print the WS endpoint from `DevToolsActivePort` |
| `chrome-allow doctor [--json]` | Environment checks, includes watcher engine |
| `chrome-allow logs [--lines <n>]` | Tail the watcher log |
| `chrome-allow install-skill [--project]` | Copy the Claude Code skill |

Exit codes: `0` success, `1` timeout / no click, `2` environment error, `64` usage error.

## Lifecycle

### Persistent

```bash
chrome-allow on
# ... multiple CDP connections, MCP calls, CLI commands ...
chrome-allow off
```

Optional auto-expiry:

```bash
chrome-allow on --ttl 300
```

### One-shot

```bash
# Start the watcher, then trigger exactly one connection yourself.
chrome-allow once --wait --timeout 30

# Or wrap the command that triggers the connection.
chrome-allow run -- chrome-devtools start --wsEndpoint "$(chrome-allow endpoint)"
```

### Prompt contract for agents

```
Chrome DevTools work begins:   chrome-allow on
Chrome DevTools work ends:     chrome-allow off
Exactly one connection:        chrome-allow once --wait --timeout 30
```

The bundled `chrome-allow` skill enforces this contract.

## Integration

### Claude Code + chrome-devtools MCP

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp", "--auto-connect"]
    }
  }
}
```

`chrome-devtools-mcp` connects lazily on the first tool call and reuses the connection. Enable the watcher before that first call:

```bash
chrome-allow on
# call chrome-devtools MCP tools
chrome-allow off
```

### chrome-devtools CLI

```bash
chrome-allow connect
# or manually:
chrome-devtools start --wsEndpoint "$(chrome-allow endpoint)"
chrome-devtools list_pages
```

### Raw CDP

```bash
npm i ws   # any CDP client works
ENDPOINT=$(chrome-allow endpoint)

chrome-allow on
node -e '
const WebSocket = require("ws");
const ws = new WebSocket(process.argv[1]);
ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Browser.getVersion" })));
ws.on("message", (d) => { console.log(d.toString()); process.exit(0); });
' "$ENDPOINT"
chrome-allow off
```

`ws://127.0.0.1:<port>/devtools/browser/<uuid>` comes from:

```
~/Library/Application Support/Google/Chrome/DevToolsActivePort
```

In approval mode, HTTP `/json/version` and `/json/list` return **404**. Only the WebSocket bootstrap path works.

## Requirements

- macOS (Intel or Apple Silicon; universal binary)
- Node.js >= 18
- Google Chrome, with `chrome://inspect#remote-debugging` enabled
- Accessibility permission for the terminal / Claude Code app:
  System Settings → Privacy & Security → Accessibility

The permission is required once. If you run the watcher from a different app, grant that app instead. `chrome-allow doctor` reports `accessibility: ok|denied`.

## Security

While the watcher is **on**, any local process that connects to Chrome's DevTools endpoint is auto-approved. That grants full control of the browser session, including cookies, saved data, navigation, and script execution.

Mitigations built in:

- Matches only the exact consent sheet title.
- Presses only 「允许」/`Allow`, never 「取消」 or 「在设置中关闭」.
- 1.5 s debounce; no blind clicking.
- Audit log at `~/.chrome-allow/watcher.log`.
- Explicit `on` / `off`; optional `--ttl`.

Operational rules:

- Turn it off as soon as the Chrome work is done.
- Do not leave it on across unrelated tasks.
- Use only on a machine you control.
- Keep the debugging port bound to loopback (Chrome does this by default).

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `accessibility: denied` | Grant Accessibility to the terminal / Claude Code app, then restart that app. |
| `error:permission` in `last-result.log` | Same as above; the watcher exits instead of silently failing. |
| `no dialog within Ns` | No CDP connection was made during the window, or the Chrome toggle is off. |
| Dialog appears but is not clicked | `chrome-allow logs`; confirm sheet title; `chrome-allow doctor`; make sure the native binary exists (`watcher-engine: native AX`). |
| `/json/version` returns 404 | Expected in approval mode. Use the WebSocket endpoint from `chrome-allow endpoint`. |
| `DevToolsActivePort` missing | Enable `chrome://inspect#remote-debugging`, or Chrome is not running. |
| Chrome restarted | The WS path changes. Re-read with `chrome-allow endpoint`. |
| `watcher already off` | Stale state file; harmless. |
| Watcher left running | `chrome-allow off`; audit with `pgrep -fl chrome-allow-watcher`. |

## FAQ

**Does this remember approval?**
No. Chrome requires approval for every new CDP connection. The watcher answers each one while enabled.

**Does it open a new Chrome?**
No. It connects to the Chrome you already have open, with your real profile.

**Does it steal focus?**
No. It uses the AX API directly; it never calls `activate`.

**Why at least ~1.5 s per connection?**
The watcher polls every 0.3 s and debounces clicks for 1.5 s to avoid pressing a stale sheet repeatedly. In practice the click lands within the first few polls.

**How is this different from `chrome-auto-connect`?**
`chrome-auto-connect` starts a short-lived AppleScript poller that calls `activate` (focus stealing) and traverses `entire contents` (unreliable on background windows). `chrome-allow` runs a native AX watcher, supports persistent/one-shot/TTL modes, exact-matches the dialog, debounces, and logs.

**Does it work with Chrome Canary / Chromium?**
The watcher targets bundle id `com.google.Chrome`. Other builds need a code change.

**Does it work headless?**
No. The consent sheet is a GUI dialog.

## Development

Build the universal watcher (requires Xcode Command Line Tools):

```bash
npm run build:watcher
```

The binary is generated at `watchers/chrome-allow-watcher` and is gitignored. `npm publish` rebuilds it via `prepublishOnly`, so the npm tarball still ships a universal binary.

Validate the package:

```bash
node --check bin/chrome-allow.js
npm pack --dry-run
```

End-to-end test: 20 independent CDP connections, all auto-approved. The procedure is in `CONTRIBUTING.md`.

## Files

```
bin/chrome-allow.js                     CLI, state, process management
watchers/watcher.swift                  native AX watcher source
watchers/chrome-allow-watcher           generated universal binary (gitignored)
watchers/allow-watcher.applescript      AppleScript fallback
scripts/build-watcher.sh                builds the universal binary
skills/chrome-allow/SKILL.md            Claude Code skill
README-CN.md                            Chinese documentation
CHANGELOG.md                            release history
CONTRIBUTING.md                         development and release workflow
SECURITY.md                             security model and reporting
```

Runtime state and logs: `~/.chrome-allow/`

## License

MIT
