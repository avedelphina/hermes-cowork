# Project context

A Cowork/Chat session runs with its working directory set to the active
project's folder (see the Projects page). **Hermes loads project instructions
from that folder itself** — verified against Hermes 0.20.6:

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

## What Cowork adds on top

The Cowork kickoff prompt (sent once, after the folder is set) asks the agent
to propose a numbered plan and stop for approval. That is task-flow scaffolding,
not project identity — it does not override anything in `AGENTS.md`.
