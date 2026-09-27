# Changelog

All notable changes to Hermes Cowork. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project is pre-1.0 so
minor versions may carry breaking changes.

## Unreleased

### Added
- **Roadmap: macOS privacy/TCC attribution.** Documented the staged path from
  clearer Cowork/Python attribution to a project-scoped filesystem boundary.

## [0.2.12] — 2026-09-27

### Added
- **Native macOS visual language.** The window now uses system semantic colors,
  SF Pro system typography, explicit light/dark appearance tokens, and native
  translucent materials.

### Changed
- **Native shell and sidebars.** Added an active macOS window material and
  redesigned the title bar, mode switcher, source-list navigation, chat list,
  and Cowork inspector with native selection, hierarchy, and separator
  patterns while preserving existing interactions.

## [0.2.11] — 2026-09-27

### Added
- Observed Cowork activity in the right sidebar, with ACP event-backed current
  and recent operations.
- A bounded main-process ACP event journal and renderer drain path so events
  produced while the task view is remounting can be recovered without duplicate
  display.

### Changed
- The primary status bar now reports Cowork dashboard connectivity rather than
  the topology-sensitive messaging-gateway ownership projection.
- Transcript copy now distinguishes an unverified background-worker claim from
  observed execution.
- Documented the staged macOS TCC attribution/filesystem-boundary roadmap.

## [0.2.10] — 2026-09-25

### Added
- **Remote agents over SSH.** A project can declare a remote origin
  ([user@]host or an `~/.ssh/config` alias); its Cowork tasks spawn
  `hermes acp` on that host (`ssh -T -o BatchMode=yes … 'exec hermes acp'`)
  with plan-gating and inline approvals unchanged. Remote targets and paths
  are strictly validated at the IPC boundary; the ACP connection pool keys
  include the SSH target so same-named local/remote profiles never share a
  child. See `docs/remote-connection.md`.
- `tests/integration/remote-ssh.test.ts` — end-to-end proof against a real
  host (handshake, full turn, orphan-free stop, fail-closed on bad target);
  runs when `HERMES_REMOTE_TEST_TARGET` is set, skipped otherwise.
- Remote projects/tasks show a ⇄ badge in the project list, task list, new
  task dialog, and goal header.

### Changed
- **Trust boundary for remote tasks.** The file browser, checkpoints, and
  revert are local-only and now refuse remote tasks outright (their files
  live on the other machine); the renderer hides the Files/Changes tabs for
  them. Remote cwds skip the local existence check but must be absolute.

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
