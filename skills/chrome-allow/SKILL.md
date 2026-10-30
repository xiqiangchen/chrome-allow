---
name: chrome-allow
description: Handle Chrome's native "要允许远程调试" consent dialog without manual clicking. Use before any chrome-devtools MCP/CLI work against an already-running, logged-in Chrome, when the first CDP connection would block on the dialog. Supports persistent on/off and one-shot modes with audit logging.
---

# chrome-allow

## Overview

Chrome 136+ runs its DevTools server in **approval mode** for the default profile: every new CDP connection opens a native sheet 「要允许远程调试吗？」. There is no persistent approval. This skill runs a native AX watcher that presses 「允许」/`Allow` while enabled, without stealing focus.

## Preconditions

Run `chrome-allow doctor` first. All required checks must pass:

- Chrome running
- `chrome://inspect#remote-debugging` enabled (`user-enabled=true`)
- `DevToolsActivePort` present
- `accessibility: ok`
- `watcher-engine: native AX (Swift)` preferred

If Accessibility is denied, stop and ask the user to grant it to the terminal / Claude Code app (System Settings → Privacy & Security → Accessibility), then restart that app.

## When to use

- Automating the user's **already-running, logged-in Chrome** through CDP.
- `chrome-devtools-mcp` or `chrome-devtools` CLI is about to connect and the consent sheet would block it.
- Multiple connections are expected (MCP daemon, repeated CLI calls) or the timing is unpredictable.

## When not to use

- Chrome was launched with a dedicated non-default `--user-data-dir`; no sheet appears.
- The task does not involve Chrome DevTools at all.
- The user did not ask for Chrome automation in this task.

## Choose a mode

| Scenario | Command |
|----------|---------|
| Multiple steps, long-lived MCP server, unknown timing | `chrome-allow on` |
| One connection, caller controls timing | `chrome-allow once --wait --timeout 30` |
| One command triggers the connection | `chrome-allow run -- <command...>` |
| Persistent but should expire automatically | `chrome-allow on --ttl <seconds>` |

## Lifecycle protocol

1. Preflight:

   ```bash
   chrome-allow status --json
   ```

   Parse `chrome.running`, `remoteDebuggingEnabled`, `endpoint`, `watcher.running`, `accessibility`.

2. Enable before the first CDP connection:

   ```bash
   chrome-allow on
   ```

   For MCP: enable **before** the first `chrome-devtools` tool call. The MCP client connects lazily on first use and then reuses the connection.

3. Do the Chrome DevTools work.

4. Always disable when the Chrome portion of the plan is finished:

   ```bash
   chrome-allow off
   chrome-allow status
   ```

5. Report the result. Do not leave persistent mode running for unrelated work.

## Command reference

```bash
chrome-allow status [--json]
chrome-allow on [--ttl <sec>] [--json]
chrome-allow off
chrome-allow once [--timeout <sec>] [--wait] [--json]
chrome-allow run [--timeout <sec>] -- <command...>
chrome-allow connect [--timeout <sec>]
chrome-allow endpoint
chrome-allow doctor [--json]
chrome-allow logs [--lines <n>]
chrome-allow install-skill [--project]
```

Useful JSON fields from `status --json`:

```json
{
  "chrome": { "running": true, "pid": 644 },
  "remoteDebuggingEnabled": true,
  "endpoint": "ws://127.0.0.1:9222/devtools/browser/<uuid>",
  "watcher": { "running": true, "mode": "persistent", "pid": 1234 },
  "accessibility": "ok"
}
```

Exit codes: `0` success, `1` timeout / no click, `2` environment error, `64` usage error.

## Integration

### chrome-devtools MCP

1. `chrome-allow on`
2. First MCP tool call connects and triggers the sheet; watcher approves it.
3. After all Chrome MCP work: `chrome-allow off`.

### chrome-devtools CLI

```bash
chrome-allow connect
# equivalent:
chrome-allow run -- chrome-devtools start --wsEndpoint "$(chrome-allow endpoint)"
chrome-devtools list_pages
```

### Raw CDP

```bash
chrome-allow on
# connect any CDP client to: chrome-allow endpoint
chrome-allow off
```

## Failure handling

| Observation | Action |
|-------------|--------|
| `accessibility: denied` | Ask user to grant Accessibility; restart terminal/Claude Code. Do not retry blindly. |
| `error:permission` in `last-result.log` | Same as above. |
| `no dialog within Ns` | Verify a CDP connection was actually made and the Chrome toggle is on. |
| Dialog visible but not clicked | `chrome-allow logs`; check `watcher-engine`; confirm sheet title. |
| `DevToolsActivePort` missing | Open `chrome://inspect#remote-debugging` and enable it. |
| Chrome restarted | Re-read `chrome-allow endpoint`; the WS path changes. |
| `/json/version` 404 | Expected in approval mode; use the WebSocket endpoint. |
| Watcher left running | `chrome-allow off`; check `pgrep -fl chrome-allow-watcher`. |

## Rules

- Enable only when the current task needs Chrome automation.
- Always turn persistent mode off after the Chrome portion; the user asked for explicit lifecycle.
- Never claim the consent is permanent. Chrome asks for every new connection.
- State the security tradeoff when enabling persistent mode: any local CDP client is auto-approved while it runs.
- Never use `activate` or focus-stealing UI scripting.
- The watcher matches only the consent sheet title and only presses 「允许」/`Allow`; never 「取消」 or 「在设置中关闭」.
- Prefer `once`/`run` when a single connection is enough.
