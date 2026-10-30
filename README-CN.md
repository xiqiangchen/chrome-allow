# chrome-allow

[English](README.md) | **简体中文**

[![npm version](https://img.shields.io/npm/v/chrome-allow.svg)](https://www.npmjs.com/package/chrome-allow)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](#环境要求)

零手动处理 Chrome 原生「要允许远程调试吗？」同意弹窗。

继续使用你真实、已登录的 Chrome。不抢焦点。支持显式 `on` / `off` 生命周期、单次模式，以及 Claude Code Skill。

## 为什么需要它

Chrome 136+ 在默认 user-data-dir 下不再接受 `--remote-debugging-port`。官方支持的路径是 `chrome://inspect#remote-debugging` 开关，它会让 DevTools 服务器进入 **approval mode**：

> In approval mode, each incoming connection needs to be approved by the user.

没有任何 pref、企业策略或「记住此客户端」选项能跳过弹窗。每个新的 CDP 连接都会重新询问。因此自动化流程只有两种选择：

1. 使用非默认 profile（独立 Chrome 会话，不是你已登录的那个）；
2. 自动回答这个弹窗。

典型场景：最近用 Codex 和 Claude Code 做爬虫、以及用 REA 复刻网站时，只要调用 Chrome DevTools 就会弹出是否同意连接的询问；没人点击时任务直接卡住。长任务和反复重连时尤其影响效率。

`chrome-allow` 是第 2 种，并且提供明确的生命周期控制。

## 工作原理

```
chrome-allow on
  └─ 启动 watchers/chrome-allow-watcher（Swift，universal binary）
       ├─ AXUIElementCreateApplication("com.google.Chrome")
       ├─ kAXWindowsAttribute → AXSheets
       ├─ 匹配 sheet 标题：远程调试 / remote debugging
       ├─ 递归查找 title 为 允许 / Allow 的 AXButton
       ├─ AXUIElementPerformAction(kAXPressAction)
       └─ 向 ~/.chrome-allow/last-result.log 追加 "clicked"
```

关键特性：

- **不抢焦点。** 不调用 `activate`，不用 `System Events` UI scripting。
- **精确匹配。** 只处理远程调试同意弹窗，只按「允许」/`Allow`。
- **绝不点击**「取消」或「在设置中关闭」。
- **点击冷却。** 1.5 秒防抖，避免对残留弹窗重复点击。
- **可审计。** 每次点击写入 `~/.chrome-allow/watcher.log`。
- **降级方案。** 原生二进制缺失时回退 AppleScript；该方案在 Chrome 窗口非前台时不可靠，仅作最后手段。

Chrome 156 实测：20 次连续独立 CDP 连接，**20/20 自动批准**，平均 1.57 秒/次。

## 安装

```bash
npm install -g chrome-allow
chrome-allow doctor
chrome-allow install-skill        # 安装 Claude Code Skill 到 ~/.claude/skills
```

`install-skill --project` 会安装到当前项目的 `./.claude/skills`。安装后重启 Claude Code 生效。

从源码安装：

```bash
git clone <repo>
cd chrome-dev-auto-allow
npm run build:watcher   # 需要 Xcode Command Line Tools
npm link
chrome-allow doctor
```

## 快速开始

1. 一次性开启 Chrome 开关：打开 `chrome://inspect#remote-debugging`，启用远程调试。
2. 检查环境：

   ```bash
   chrome-allow doctor
   ```

3. 开启 watcher，然后触发连接：

   ```bash
   chrome-allow on
   chrome-allow connect
   ```

4. 完成后：

   ```bash
   chrome-allow off
   chrome-allow status
   ```

## 命令

| 命令 | 作用 |
|------|------|
| `chrome-allow status [--json]` | Chrome、开关、endpoint、watcher、辅助功能状态 |
| `chrome-allow on [--ttl <秒>]` | 常驻 watcher，直到 `off` 或 TTL 到期 |
| `chrome-allow off` | 关闭常驻 watcher |
| `chrome-allow once [--timeout <秒>] [--wait] [--json]` | 单次 watcher，默认 30 秒 |
| `chrome-allow run [--timeout <秒>] -- <命令...>` | 命令执行期间使用单次 watcher |
| `chrome-allow connect [--timeout <秒>]` | 启动 `chrome-devtools` CLI 并列出页面 |
| `chrome-allow endpoint` | 输出 `DevToolsActivePort` 中的 WS endpoint |
| `chrome-allow doctor [--json]` | 环境检查，包含 watcher 引擎 |
| `chrome-allow logs [--lines <n>]` | 查看 watcher 日志 |
| `chrome-allow install-skill [--project]` | 安装 Claude Code Skill |

退出码：`0` 成功；`1` 超时/未点击；`2` 环境错误；`64` 用法错误。

## 生命周期

### 常驻

```bash
chrome-allow on
# ... 多次 CDP 连接、MCP 调用、CLI 命令 ...
chrome-allow off
```

可选自动过期：

```bash
chrome-allow on --ttl 300
```

### 单次

```bash
# 先启动 watcher，然后由你自己触发一次连接
chrome-allow once --wait --timeout 30

# 或包裹会触发连接的命令
chrome-allow run -- chrome-devtools start --wsEndpoint "$(chrome-allow endpoint)"
```

### 智能体提示词约定

```
Chrome DevTools 任务开始：  chrome-allow on
Chrome DevTools 任务结束：  chrome-allow off
只连接一次：                chrome-allow once --wait --timeout 30
```

内置的 `chrome-allow` Skill 会强制执行这个约定。

## 集成

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

`chrome-devtools-mcp` 在首次工具调用时才懒连接，之后复用连接。请在第一次调用前开启 watcher：

```bash
chrome-allow on
# 调用 chrome-devtools MCP 工具
chrome-allow off
```

### chrome-devtools CLI

```bash
chrome-allow connect
# 或手动：
chrome-devtools start --wsEndpoint "$(chrome-allow endpoint)"
chrome-devtools list_pages
```

### 原生 CDP

```bash
npm i ws   # 任意 CDP 客户端均可
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

`ws://127.0.0.1:<port>/devtools/browser/<uuid>` 来自：

```
~/Library/Application Support/Google/Chrome/DevToolsActivePort
```

在 approval mode 下，HTTP `/json/version` 和 `/json/list` 返回 **404**，只有 WebSocket 引导路径可用。

## 环境要求

- macOS（Intel 或 Apple Silicon；universal binary）
- Node.js >= 18
- Google Chrome，并已启用 `chrome://inspect#remote-debugging`
- 终端 / Claude Code 应用需要辅助功能权限：
  系统设置 → 隐私与安全性 → 辅助功能

权限只需授予一次。如果从其他应用运行 watcher，请给那个应用授权。`chrome-allow doctor` 会显示 `accessibility: ok|denied`。

## 安全

watcher 处于 **on** 期间，任何连接 Chrome DevTools endpoint 的本地进程都会被自动批准。这等于完全控制该浏览器会话，包括 Cookie、保存的数据、导航和脚本执行。

内置缓解措施：

- 只匹配精确的同意弹窗标题。
- 只按「允许」/`Allow`，绝不按「取消」或「在设置中关闭」。
- 1.5 秒防抖，不盲目连点。
- 审计日志：`~/.chrome-allow/watcher.log`。
- 显式 `on` / `off`；可选 `--ttl`。

使用规则：

- Chrome 任务结束立刻关闭。
- 不要跨无关任务常驻。
- 只在你自己控制的机器上使用。
- 调试端口保持 loopback（Chrome 默认如此）。

## 排错

| 现象 | 原因 / 处理 |
|------|-------------|
| `accessibility: denied` | 给终端 / Claude Code 应用授予辅助功能权限，然后重启该应用。 |
| `last-result.log` 出现 `error:permission` | 同上；watcher 会直接退出，不会静默失败。 |
| `no dialog within Ns` | 窗口期内没有建立 CDP 连接，或 Chrome 开关未开。 |
| 弹窗出现但没被点击 | `chrome-allow logs`；确认弹窗标题；`chrome-allow doctor`；确认原生二进制存在（`watcher-engine: native AX`）。 |
| `/json/version` 返回 404 | approval mode 下的正常现象。使用 `chrome-allow endpoint` 输出的 WebSocket 地址。 |
| `DevToolsActivePort` 不存在 | 打开 `chrome://inspect#remote-debugging` 启用，或 Chrome 未运行。 |
| Chrome 重启 | WS 路径会变化，重新执行 `chrome-allow endpoint`。 |
| `watcher already off` | 状态文件过期，无影响。 |
| watcher 未关闭 | `chrome-allow off`；用 `pgrep -fl chrome-allow-watcher` 审计。 |

## FAQ

**会记住授权吗？**
不会。Chrome 对每个新的 CDP 连接都要求批准；watcher 在开启期间逐个回答。

**会打开新的 Chrome 吗？**
不会。连接你当前已打开的 Chrome，使用真实 profile。

**会抢焦点吗？**
不会。直接使用 AX API，从不调用 `activate`。

**为什么每次至少约 1.5 秒？**
watcher 每 0.3 秒轮询一次，并有 1.5 秒点击冷却，避免对残留弹窗重复点击。实际点击通常在前几次轮询内完成。

**和 `chrome-auto-connect` 有什么区别？**
`chrome-auto-connect` 启动短命 AppleScript 轮询器，会调用 `activate`（抢焦点），并依赖 `entire contents`（后台窗口下不可靠）。`chrome-allow` 使用原生 AX watcher，支持常驻/单次/TTL，精确匹配弹窗，带防抖和日志。

**支持 Chrome Canary / Chromium 吗？**
watcher 固定匹配 bundle id `com.google.Chrome`，其他版本需要改代码。

**支持 headless 吗？**
不支持。同意弹窗是 GUI 对话框。

## 开发

构建 universal watcher（需要 Xcode Command Line Tools）：

```bash
npm run build:watcher
```

生成的二进制在 `watchers/chrome-allow-watcher`，已加入 `.gitignore`。`npm publish` 时 `prepublishOnly` 会重新构建，所以 npm 包里仍然带 universal binary。

校验发布包：

```bash
node --check bin/chrome-allow.js
npm pack --dry-run
```

端到端测试：20 次独立 CDP 连接全部自动批准，测试步骤见 `CONTRIBUTING.md`。

## 文件结构

```
bin/chrome-allow.js                     CLI、状态、进程管理
watchers/watcher.swift                  原生 AX watcher 源码
watchers/chrome-allow-watcher           生成的 universal binary（已 gitignore）
watchers/allow-watcher.applescript      AppleScript 降级方案
scripts/build-watcher.sh                构建 universal binary
skills/chrome-allow/SKILL.md            Claude Code Skill
README.md                               英文文档
CHANGELOG.md                            版本历史
CONTRIBUTING.md                         开发与发布流程
SECURITY.md                             安全模型与漏洞报告
```

运行时状态与日志：`~/.chrome-allow/`

## 许可证

MIT
