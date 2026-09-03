# Operating Hermes Cowork

## Requirements

- macOS 13+ (Apple Silicon).
- Hermes Agent ≥ 0.20.0 on `$PATH` (`hermes --version`). ACP is verified
  against 0.20.6 — see `docs/acp-notes.md`.
- The app talks to a `hermes dashboard` on `127.0.0.1:9119`. It reuses one that
  is already running; otherwise it starts its own and kills only that one on
  quit.

## First run

1. `hermes` must be configured (a provider/model set up). If it is not, the
   app shows a runtime error with the failing probe.
2. Pick a profile from the title-bar chip. The active profile drives which
   Hermes identity and model a task runs as.
3. Create a **Project** (Projects page, or the title-bar `📁` chip): a name,
   the profile to run it as, and an optional local folder. A folderless project
   is chat-only; Cowork tasks require a folder. Removing a project never
   deletes its folder.
4. A Cowork task runs inside its working folder; a Chat runs in the active
   project's folder when it has one, otherwise `$HOME`. When a folder is set,
   Hermes loads `AGENTS.md` / `.hermes.md` from it automatically — see
   `docs/project-context.md`.

## Where local state lives

`~/Library/Application Support/@hermes-cowork/desktop/`

| file           | contents                                    |
|----------------|---------------------------------------------|
| `projects.json`| projects + the active project pointer       |
| `tasks.json`   | Cowork tasks (metadata only — transcripts stay in Hermes) |
| `chats.json`   | Chat conversations (metadata only — transcripts stay in Hermes) |

Both migrate forward automatically on version upgrades. A corrupt file is
replaced with an empty one on next launch (state is recoverable from Hermes).

## The security / approval contract

See `docs/security-model.md`. In short: a task only runs against an explicit,
existing folder; file access is confined to that folder (path-traversal and
symlink-escape are rejected); destructive operations always prompt regardless
of approval mode; the app never grants persistent permission on your behalf.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Electron crashes on launch with `Cannot read properties of undefined (reading 'whenReady')` | `ELECTRON_RUN_AS_NODE=1` is set in the shell. Run `env -u ELECTRON_RUN_AS_NODE pnpm dev`. |
| Status bar shows "Hermes unreachable" | The dashboard stopped answering. Click it → "Re-check now". If it stays down, restart `hermes dashboard`. |
| Profile chip shows "unknown" | The dashboard `/api/profiles` call failed (bad token or dashboard down). Re-check the runtime status. |
| Cowork transcript stuck on "Hermes will propose a plan shortly…" | The ACP turn produced no events. Use **↻ Reconnect** in the goal header to reload the session from Hermes. |
| A task shows "interrupted" | The app exited while it was live. Open it from the Tasks page to resume — Hermes replays the conversation via `session/load`. |
| An edit went wrong | Cowork **Changes** tab → **Revert** restores the pre-edit file (or deletes it if it was new). |
| Worker never finishes | Stop it from the Subtasks tab; its ACP child is killed. Re-dispatch if needed. |

## Recovery

- **Resume a task**: Tasks page → Open/Resume. State comes back from Hermes.
- **Reconnect a crashed session**: goal header → ↻ Reconnect.
- **Undo an edit**: Changes tab → Revert.
- **Reset all local app state**: quit, delete the two JSON files above, relaunch.
  Projects must be re-created; Hermes sessions are untouched.
