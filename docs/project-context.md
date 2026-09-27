# Project context

A Cowork task runs with its working directory set to its folder; a Chat uses
the active project's folder when that project has one (see the Projects page),
otherwise `$HOME`. When the `cwd` is a project folder, **Hermes loads project
instructions from that folder itself** — verified against Hermes 0.20.6:

| File          | Loaded | Notes                                        |
|---------------|--------|----------------------------------------------|
| `AGENTS.md`   | yes    | the standard cross-tool convention           |
| `.hermes.md`  | yes    | Hermes-specific overrides / additions        |

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