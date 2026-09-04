# Changelog

All notable changes to Hermes Cowork. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project is pre-1.0 so
minor versions may carry breaking changes.

## [0.2.0] — 2026-09-04

First signed + notarised build.

### Added
- Agent output renders as Markdown in Chat and the Cowork transcript / Plan
  tab (`react-markdown` + `remark-gfm`).
- Composer send key is configurable — ⌘/Ctrl+Enter (default) or plain Enter,
  with Shift+Enter for a newline. Persisted per machine.
- Project folder picker can create a new folder.
- The Plan tab renders the agent's live step list from ACP `plan` updates,
  with per-step status.

### Fixed
- **Session isolation.** A Cowork task's isolated agent no longer ingests
  `session/update` frames for other sessions on the same `HERMES_HOME`
  (gateway conversations included) — only exact-`sessionId` matches are
  surfaced. The Chat/Cowork stores also drop events until bound to a session.
- **Plan approval after the first.** When the agent re-plans mid-task, the
  approval gate re-arms instead of silently executing the new plan.
- **Orphaned agent processes.** Re-opening a Cowork task no longer leaves the
  previous isolated `hermes acp` child running.
- Clearer visual separation between your messages and the agent's.

### Docs
- `docs/acp-notes.md`: `plan` variant, full model list on `session/load`,
  the (absent) `approve` command, `stopReason` is always `end_turn`.

## [0.1.1] — 2026-09-03

- Chat sessions, model switcher, brand icon, assorted hardening. Unsigned DMG.

## [0.1.0] — 2026-09-02

- First packaged build. Chat + Cowork end to end against Hermes 0.20.6.
  macOS Apple Silicon, unsigned DMG.

[0.2.0]: https://github.com/avedelphina/hermes-cowork/releases/tag/v0.2.0
[0.1.1]: https://github.com/avedelphina/hermes-cowork/releases/tag/v0.1.1
[0.1.0]: https://github.com/avedelphina/hermes-cowork/releases/tag/v0.1.0
