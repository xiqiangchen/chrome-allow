#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const VERSION = require('../package.json').version;
const HOME = os.homedir();

const STATE_DIR = path.join(HOME, '.chrome-allow');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const LOG_FILE = path.join(STATE_DIR, 'watcher.log');
const RESULT_FILE = path.join(STATE_DIR, 'last-result.log');

const WATCHER = path.join(__dirname, '..', 'watchers', 'allow-watcher.applescript');
const NATIVE_WATCHER = path.join(__dirname, '..', 'watchers', 'chrome-allow-watcher');

const CHROME_SUPPORT = path.join(HOME, 'Library', 'Application Support', 'Google', 'Chrome');
const LOCAL_STATE = path.join(CHROME_SUPPORT, 'Local State');
const DEVTOOLS_PORT = path.join(CHROME_SUPPORT, 'DevToolsActivePort');

// ---------- helpers ----------

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readState() {
  return readJson(STATE_FILE);
}

function writeState(state) {
  ensureStateDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

function clearState() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function chromePid() {
  const r = spawnSync('pgrep', ['-x', 'Google Chrome'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const pid = parseInt(r.stdout.trim().split('\n')[0], 10);
  return Number.isNaN(pid) ? null : pid;
}

function remoteDebuggingEnabled() {
  const state = readJson(LOCAL_STATE);
  return state?.devtools?.remote_debugging?.['user-enabled'] === true;
}

function readEndpoint() {
  try {
    const [port, wsPath] = fs.readFileSync(DEVTOOLS_PORT, 'utf8').split('\n');
    if (!port || !wsPath) return null;
    return `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
  } catch {
    return null;
  }
}

function axPermission() {
  const script = 'tell application "System Events" to tell process "Google Chrome" to get count of windows';
  const r = spawnSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8' });
  if (r.status === 0) return { ok: true };
  const msg = (r.stderr || '').trim();
  const denied = /assistive|辅助访问|not authorized|1743|25211/i.test(msg);
  return { ok: false, denied, message: msg };
}

function cmdExists(name) {
  const r = spawnSync('which', [name], { encoding: 'utf8' });
  return r.status === 0;
}

function truncateResult() {
  ensureStateDir();
  fs.writeFileSync(RESULT_FILE, '');
}

function lastResult() {
  try {
    const lines = fs.readFileSync(RESULT_FILE, 'utf8').split('\n').filter(Boolean);
    return lines.length ? lines[lines.length - 1] : null;
  } catch {
    return null;
  }
}

function spawnWatcher(mode, timeoutSeconds, { truncate = true } = {}) {
  ensureStateDir();
  if (truncate) truncateResult();

  const logFd = fs.openSync(LOG_FILE, 'a');
  const useNative = fs.existsSync(NATIVE_WATCHER);
  const executable = useNative ? NATIVE_WATCHER : '/usr/bin/osascript';
  const executableArgs = useNative
    ? [mode, String(timeoutSeconds), RESULT_FILE]
    : [WATCHER, mode, String(timeoutSeconds), RESULT_FILE];
  const child = spawn(executable, executableArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  const startedAt = new Date();
  const state = {
    mode,
    pid: child.pid,
    timeoutSeconds,
    startedAt: startedAt.toISOString(),
    expiresAt: timeoutSeconds > 0 ? new Date(startedAt.getTime() + timeoutSeconds * 1000).toISOString() : null,
  };
  writeState(state);
  return state;
}

function stopWatcher(state) {
  if (state?.pid && isAlive(state.pid)) {
    try { process.kill(state.pid, 'SIGTERM'); } catch {}
  }
  clearState();
}

function waitForPidExit(pid, maxMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (!isAlive(pid) || Date.now() - started > maxMs) {
        clearInterval(timer);
        resolve(!isAlive(pid));
      }
    }, 100);
  });
}

function waitForClick(maxMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const result = lastResult();
      if (result === 'clicked' || result === 'error:permission' || Date.now() - started > maxMs) {
        clearInterval(timer);
        resolve(result);
      }
    }, 100);
  });
}

function consumeFlag(args, name, hasValue = false) {
  const index = args.indexOf(name);
  if (index === -1) return { found: false, value: null, rest: args };
  const rest = args.slice();
  let value = null;
  if (hasValue) {
    value = rest[index + 1] ?? null;
    rest.splice(index, 2);
  } else {
    rest.splice(index, 1);
  }
  return { found: true, value, rest };
}

// ---------- commands ----------

function cmdStatus(jsonMode) {
  const pid = chromePid();
  const state = readState();
  const alive = isAlive(state?.pid);
  const enabled = remoteDebuggingEnabled();
  const endpoint = readEndpoint();
  const ax = axPermission();

  if (!alive && state) clearState();

  const data = {
    chrome: { running: Boolean(pid), pid },
    remoteDebuggingEnabled: enabled,
    endpoint,
    watcher: alive
      ? { running: true, mode: state.mode, pid: state.pid, startedAt: state.startedAt, expiresAt: state.expiresAt }
      : { running: false },
    accessibility: ax.ok ? 'ok' : (ax.denied ? 'denied' : 'error'),
  };

  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
    return data.watcher.running || (data.chrome.running && data.remoteDebuggingEnabled) ? 0 : 0;
  }

  const ok = (v) => (v ? '✓' : '✗');
  console.log('chrome-allow status');
  console.log(`  ${ok(pid)} Chrome running${pid ? ` (pid ${pid})` : ''}`);
  console.log(`  ${ok(enabled)} remote debugging toggle (chrome://inspect#remote-debugging)`);
  console.log(`  ${ok(endpoint)} DevToolsActivePort${endpoint ? `: ${endpoint}` : ' (missing)'}`);
  if (alive) {
    console.log(`  ✓ watcher: ${state.mode} (pid ${state.pid})${state.expiresAt ? `, expires ${state.expiresAt}` : ''}`);
  } else {
    console.log('  ✗ watcher: off');
  }
  console.log(`  ${ok(ax.ok)} Accessibility${ax.ok ? '' : ` (${ax.denied ? 'denied' : ax.message})`}`);
  console.log(`  log: ${LOG_FILE}`);
  return 0;
}

function cmdOn(args) {
  const ttl = consumeFlag(args, '--ttl', true);
  const jsonMode = consumeFlag(ttl.rest, '--json').found;
  const timeoutSeconds = ttl.found ? Math.max(1, parseInt(ttl.value, 10) || 0) : 0;

  const existing = readState();
  if (existing && isAlive(existing.pid)) {
    if (existing.mode === 'persistent') {
      const out = { status: 'already-on', pid: existing.pid, mode: existing.mode, expiresAt: existing.expiresAt };
      console.log(jsonMode ? JSON.stringify(out) : `watcher already running (pid ${existing.pid}, ${existing.mode})`);
      return 0;
    }
    stopWatcher(existing);
  }

  if (!remoteDebuggingEnabled()) {
    const msg = 'remote debugging toggle is off: open chrome://inspect#remote-debugging and enable it first';
    if (jsonMode) console.log(JSON.stringify({ status: 'error', message: msg }));
    else console.error(`error: ${msg}`);
    return 2;
  }

  const state = spawnWatcher('persistent', timeoutSeconds);

  const out = {
    status: 'on',
    mode: 'persistent',
    pid: state.pid,
    expiresAt: state.expiresAt,
    log: LOG_FILE,
    warning: 'persistent mode auto-approves every Chrome remote-debugging consent dialog while running; run `chrome-allow off` when done',
  };

  if (jsonMode) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`watcher ON (persistent, pid ${state.pid}${state.expiresAt ? `, expires ${state.expiresAt}` : ''})`);
    console.log(`log: ${LOG_FILE}`);
    console.log('');
    console.log('SECURITY: while ON, any local process that connects to Chrome DevTools gets auto-approved.');
    console.log('Turn it off with `chrome-allow off` as soon as the Chrome work is done.');
  }
  return 0;
}

function cmdOff() {
  const state = readState();
  if (!state || !isAlive(state.pid)) {
    clearState();
    console.log('watcher already off');
    return 0;
  }
  stopWatcher(state);
  console.log(`watcher OFF (pid ${state.pid})`);
  return 0;
}

async function cmdOnce(args) {
  const timeoutFlag = consumeFlag(args, '--timeout', true);
  const waitFlag = consumeFlag(timeoutFlag.rest, '--wait');
  const jsonMode = consumeFlag(waitFlag.rest, '--json').found;
  const timeoutSeconds = Math.max(1, parseInt(timeoutFlag.value, 10) || 30);

  const existing = readState();
  if (existing && isAlive(existing.pid) && existing.mode === 'persistent') {
    const out = { status: 'already-on', mode: 'persistent', pid: existing.pid, note: 'persistent watcher already covers this request' };
    console.log(jsonMode ? JSON.stringify(out) : `persistent watcher already running (pid ${existing.pid}); nothing to do`);
    return 0;
  }
  if (existing && isAlive(existing.pid)) stopWatcher(existing);

  const state = spawnWatcher('once', timeoutSeconds);

  if (!waitFlag.found) {
    const out = { status: 'once-started', pid: state.pid, timeoutSeconds, log: LOG_FILE };
    console.log(jsonMode ? JSON.stringify(out) : `watcher ON (once, pid ${state.pid}, timeout ${timeoutSeconds}s)`);
    return 0;
  }

  await waitForPidExit(state.pid, (timeoutSeconds + 5) * 1000);
  if (isAlive(state.pid)) {
    try { process.kill(state.pid, 'SIGTERM'); } catch {}
  }
  clearState();

  const result = lastResult() || 'timeout';
  const out = { status: result === 'clicked' ? 'clicked' : 'timeout', result, timeoutSeconds, log: LOG_FILE };
  if (jsonMode) console.log(JSON.stringify(out));
  else console.log(result === 'clicked' ? 'clicked「允许」' : `no dialog within ${timeoutSeconds}s (${result})`);
  return result === 'clicked' ? 0 : 1;
}

async function cmdRun(args) {
  const separator = args.indexOf('--');
  const commandArgs = separator === -1 ? [] : args.slice(separator + 1);
  const optionArgs = separator === -1 ? args : args.slice(0, separator);
  const timeoutFlag = consumeFlag(optionArgs, '--timeout', true);
  const timeoutSeconds = Math.max(1, parseInt(timeoutFlag.value, 10) || 30);

  if (!commandArgs.length) {
    console.error('usage: chrome-allow run [--timeout N] -- <command...>');
    return 64;
  }

  const existing = readState();
  let ephemeral = null;
  if (!(existing && isAlive(existing.pid) && existing.mode === 'persistent')) {
    if (existing && isAlive(existing.pid)) stopWatcher(existing);
    ephemeral = spawnWatcher('once', timeoutSeconds);
  }

  const result = spawnSync(commandArgs[0], commandArgs.slice(1), { stdio: 'inherit' });
  const code = result.status ?? 1;

  if (ephemeral) {
    const clicked = await waitForClick(1500);
    stopWatcher(ephemeral);
    console.error(`[chrome-allow] dialog: ${clicked || 'not observed'}`);
  }

  return code;
}

async function cmdConnect(args) {
  const timeoutFlag = consumeFlag(args, '--timeout', true);
  const timeoutSeconds = Math.max(1, parseInt(timeoutFlag.value, 10) || 30);

  if (!cmdExists('chrome-devtools')) {
    console.error('error: chrome-devtools CLI not found. Install: npm install -g chrome-devtools-mcp@latest');
    return 2;
  }

  const endpoint = readEndpoint();
  if (!endpoint) {
    console.error('error: DevToolsActivePort missing. Enable chrome://inspect#remote-debugging first.');
    return 2;
  }

  const existing = readState();
  let ephemeral = null;
  if (!(existing && isAlive(existing.pid) && existing.mode === 'persistent')) {
    if (existing && isAlive(existing.pid)) stopWatcher(existing);
    ephemeral = spawnWatcher('once', timeoutSeconds);
  }

  console.log(`endpoint: ${endpoint}`);
  const start = spawnSync('chrome-devtools', ['start', '--wsEndpoint', endpoint], { stdio: 'inherit' });
  if (start.status !== 0) {
    if (ephemeral) stopWatcher(ephemeral);
    return start.status ?? 1;
  }

  const list = spawnSync('chrome-devtools', ['list_pages'], { stdio: 'inherit' });

  if (ephemeral) {
    const clicked = await waitForClick(1500);
    stopWatcher(ephemeral);
    console.error(`[chrome-allow] dialog: ${clicked || 'not observed'}`);
  }

  return list.status ?? 0;
}

function cmdDoctor(jsonMode) {
  ensureStateDir();
  const checks = [];
  const add = (name, ok, detail, required = true) => checks.push({ name, ok, detail, required });

  add('node', true, process.version);
  add('osascript', fs.existsSync('/usr/bin/osascript'), '/usr/bin/osascript');
  const pid = chromePid();
  add('chrome', Boolean(pid), pid ? `pid ${pid}` : 'not running');
  add('remote-debugging-toggle', remoteDebuggingEnabled(), remoteDebuggingEnabled() ? 'user-enabled=true' : 'enable chrome://inspect#remote-debugging');
  const endpoint = readEndpoint();
  add('devtools-active-port', Boolean(endpoint), endpoint || 'missing');
  const ax = axPermission();
  add('accessibility', ax.ok, ax.ok ? 'ok' : (ax.message || 'denied'));
  add('chrome-devtools-cli', cmdExists('chrome-devtools'), cmdExists('chrome-devtools') ? 'found' : 'npm install -g chrome-devtools-mcp@latest', false);
  const nativeWatcher = fs.existsSync(NATIVE_WATCHER);
  add('watcher-engine', nativeWatcher, nativeWatcher ? 'native AX (Swift)' : 'AppleScript fallback', false);
  const state = readState();
  const alive = isAlive(state?.pid);
  add('watcher', alive, alive ? `${state.mode} pid ${state.pid}` : 'off', false);
  add('state-dir', fs.existsSync(STATE_DIR), STATE_DIR);

  if (jsonMode) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    for (const c of checks) console.log(`  ${c.ok ? '✓' : (c.required ? '✗' : '-')} ${c.name}: ${c.detail}`);
  }
  return checks.every((c) => c.ok || !c.required) ? 0 : 1;
}

function cmdLogs(args) {
  const linesFlag = consumeFlag(args, '--lines', true);
  const lines = Math.max(1, parseInt(linesFlag.value, 10) || 40);
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8').trimEnd().split('\n');
    console.log(content.slice(-lines).join('\n'));
  } catch {
    console.log('(no log yet)');
  }
  return 0;
}

function cmdInstallSkill(args) {
  const projectMode = args.includes('--project');
  const base = projectMode
    ? path.join(process.cwd(), '.claude', 'skills')
    : path.join(HOME, '.claude', 'skills');
  const targetDir = path.join(base, 'chrome-allow');
  const source = path.join(__dirname, '..', 'skills', 'chrome-allow', 'SKILL.md');

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(source, path.join(targetDir, 'SKILL.md'));
  console.log(`skill installed: ${path.join(targetDir, 'SKILL.md')}`);
  console.log('restart Claude Code to load it');
  return 0;
}

function showHelp() {
  console.log(`chrome-allow v${VERSION}
Zero-touch approval for Chrome's "允许远程调试" dialog.

usage: chrome-allow <command> [options]

commands:
  status [--json]                     show Chrome / toggle / watcher / AX state
  on [--ttl <sec>] [--json]           persistent watcher (explicit enable)
  off                                 stop persistent watcher
  once [--timeout <sec>] [--wait]     one-shot watcher (default 30s)
  run [--timeout <sec>] -- <cmd...>   one-shot watcher around a command
  connect [--timeout <sec>]           connect chrome-devtools CLI now
  endpoint                            print ws endpoint from DevToolsActivePort
  doctor [--json]                     environment checks
  logs [--lines <n>]                  tail watcher log
  install-skill [--project]           copy the Claude Code skill to ~/.claude/skills
  -h, --help / -v, --version

lifecycle:
  chrome-allow on
  ... chrome dev work ...
  chrome-allow off

SECURITY: persistent mode auto-approves every CDP connection while running.`);
}

// ---------- main ----------

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === '-h' || command === '--help') { showHelp(); return 0; }
  if (command === '-v' || command === '--version') { console.log(`chrome-allow v${VERSION}`); return 0; }

  switch (command) {
    case 'status': return cmdStatus(argv.includes('--json'));
    case 'on': return cmdOn(argv.slice(1));
    case 'off': return cmdOff();
    case 'once': return await cmdOnce(argv.slice(1));
    case 'run': return await cmdRun(argv.slice(1));
    case 'connect': return await cmdConnect(argv.slice(1));
    case 'endpoint': {
      const endpoint = readEndpoint();
      if (!endpoint) { console.error('DevToolsActivePort missing'); return 2; }
      console.log(endpoint);
      return 0;
    }
    case 'doctor': return cmdDoctor(argv.includes('--json'));
    case 'logs': return cmdLogs(argv.slice(1));
    case 'install-skill': return cmdInstallSkill(argv.slice(1));
    default:
      console.error(`unknown command: ${command}`);
      showHelp();
      return 64;
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
