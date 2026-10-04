# Project context

A Cowork task runs with its working directory set to its folder; a Chat uses
the active project's folder when that project has one (see the Projects page),
otherwise `$HOME`. When the `cwd` is a project folder, **Hermes loads project
instructions from that folder itself** — verified against Hermes 0.20.6:

| File          | Loaded | Notes                                        |
|---------------|--------|----------------------------------------------|
| `AGENTS.md`   | yes    | the standard cross-tool convention           |
| `.hermes.md`  | yes    | Hermes-specific overrides / additions        |

Hermes 0.21.3 also loads `HERMES.md`, `AGENTS.override.md`, `CLAUDE.md`,
`.cursorrules` and `.cursor/rules/*.mdc` (first match wins at the root), and
the nested `AGENTS.md` / `CLAUDE.md` / `.cursorrules` of any subfolder the agent
touches. The Projects page lists all of them.

Both are picked up automatically when the ACP session's `cwd` is the project
folder. Hermes Cowork does **not** inject this content into prompts, and does
**not** write it into the profile's memory or global identity — the folder is
the single source of project instruction, and it travels with the repo.

Precedence and merging are Hermes' own behaviour; when both files exist Hermes
sees both. To give a project instructions, add an `AGENTS.md` (or `.hermes.md`)
at its root. The Projects page shows which of these files each project has.

The Cowork kickoff is sent with the user's first composer prompt. Draft task
creation persists the task context first and starts ACP lazily through the main
process; it does not create a Hermes transcript or background process before
that first prompt.
## Draft operations

A draft has a title and validated execution context but no ACP session or
transcript. It is not an interrupted run and cannot be resumed with
`session/load`. The first composer prompt uses `task:start`; only after that
binding exists do stop, reconnect, model selection, approvals, and transcript
replay become available.
## What Cowork adds on top

The Cowork kickoff prompt (sent once, with the first user prompt after lazy ACP
startup) asks the agent to propose a numbered plan and stop for approval. That
is task-flow scaffolding, not project identity — it does not override anything
in `AGENTS.md`.

## Approving instruction files

These files steer the agent, so whoever can change one controls it: a teammate's
commit, a pulled branch, a cloned repository, or the agent itself leaving a
prompt for its next run. Hermes' own injection scanner only catches crude
patterns, and Hermes has no way to switch context files off under `hermes acp`.
So Cowork pins what you approved.

- **When it asks.** Before any local session starts in a folder (a new Cowork
  task, a chat in a project, resuming either), main compares every instruction
  file in the folder with what you approved for that project. If a file is new,
  changed or removed, a native dialog lists the changes: the added and removed
  lines for a changed file, the content of a new one, and who last committed it
  (`git log`). **Approve** pins the current content; **Cancel** refuses to
  start. The dialog is in main, so a compromised renderer cannot approve.
- **What is pinned.** Every candidate file, not only the one that would win: a
  new `.hermes.md` outranks `AGENTS.md`, and that must be noticed. The content
  is kept so a later change can be shown as a diff (`context-pins.json` in
  userData; never writable from the renderer; removed with the project).
- **First start.** Nothing is approved yet, so a project with an `AGENTS.md`
  asks once. A task with no project has nothing to compare with, so it asks on
  every start in a folder that has instruction files.
- **Projects page.** Shows each file, whether it matches what you approved, and
  who last changed it.

Limits, so they are not mistaken for guarantees:

- The check is at session start. A nested file that changes during a task is
  not caught until the next start, and a file changed in the instant between
  the check and Hermes reading it is not caught at all.
- Remote tasks are not covered: the files live on the other machine.
- Other content the agent reads (a README, a code comment) can carry
  instructions too. Approval of these files does not make a repository trusted;
  the plan gate and approvals still apply.
- The scan is bounded (6 levels, 5000 folders) and not git-aware.
