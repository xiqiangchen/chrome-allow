# Changelog

## Unreleased

- Bilingual documentation: `README.md` (English) and `README-CN.md` (Chinese), with language switch links.
- Added the Codex / Claude Code crawler and REA site-reconstruction motivation to both READMEs.
- Added `CONTRIBUTING.md`, `SECURITY.md`, `.gitignore`, and GitHub Actions CI.
- Added `scripts/build-watcher.sh`; the universal binary is now a gitignored build artifact and is rebuilt by `prepublishOnly` and CI.
- Excluded local `docs/ai` analysis notes from the open-source repository.
- Open-source repository preparation.

## 0.1.2 — 2026-10-30

- CLI `--version` now reads `package.json` instead of a hardcoded string.
- README rewritten: architecture, lifecycle, MCP/CLI/raw CDP integration, permissions, security, troubleshooting, FAQ, development.
- Skill expanded with preconditions, mode selection, lifecycle checklist, and failure handling.
- Added this changelog and npm publish notes.

## 0.1.1 — 2026-10-30

- Native Swift AX watcher replaces the unreliable AppleScript `entire contents` traversal.
- Universal binary: arm64 + x86_64.
- 1.5 s click debounce.
- `watcher-engine` check in `doctor`.
- Verified end-to-end: 20/20 CDP connections auto-approved, avg 1.57 s.

## 0.1.0 — 2026-10-30

- Initial release.
- Persistent / one-shot watcher lifecycle.
- AppleScript watcher fallback.
- `status`, `on`, `off`, `once`, `run`, `connect`, `endpoint`, `doctor`, `logs`, `install-skill`.
- Claude Code skill.
