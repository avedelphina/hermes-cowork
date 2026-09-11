# Hermes Cowork — security and approval contract

Status: **v0** (Task 0.3). Defines the rules; enforcement lands incrementally
across Phases 1–5. Where a rule is not yet enforced in code it is marked
_(not yet enforced)_ so the gap is visible rather than implied.

## Principles

1. **Folder scope is the trust boundary.** A task runs against exactly one
   absolute directory the user explicitly picked ("the root"). No task starts
   without one.
2. **Default-deny for anything destructive.** Delete, terminal, and network
   are off until the user grants them. Read is the only capability on by
   default.
3. **No silent irreversible actions.** Deleting files, overwriting outside the
   root, running shell commands, and network calls either require a granted
   policy bit or an inline approval — never both absent.
4. **The app never widens its own scope.** Only an explicit user action
   (folder picker, policy toggle) changes a policy. Hermes cannot talk the app
   into a broader scope.
5. **Honest failure.** A denied, cancelled, failed, or expired action is
   reported to the user with its real state; transcripts and artifacts are
   preserved on failure.

## Permission vocabulary

`PermissionPolicy` (`apps/desktop/src/shared/types.ts`):

| bit        | default | meaning                                                        |
|------------|---------|----------------------------------------------------------------|
| `root`     | —       | absolute path the task is scoped to                            |
| `read`     | `true`  | read files under `root`                                        |
| `write`    | `false` | create / modify files under `root`                             |
| `delete`   | `false` | delete files under `root` — **always** also prompts inline     |
| `terminal` | `false` | run subprocesses / shell commands                              |
| `network`  | `false` | outbound network access                                        |

`defaultPolicy(root)` returns read-only. Widening is a deliberate user action.

## Folder-scope enforcement

- **Task start** (`acp:start` IPC): the `cwd` must be an existing absolute
  directory (`isExistingDir`) or the start is refused. _Enforced._
- **File access under a root**: `resolveWithinRoot(root, candidate)` returns the
  resolved path or `null` if it escapes via `..`, an absolute path, or lands on
  the root's parent; `project-fs.ts` also `realpath`-checks so a symlink target
  outside the root is rejected — for a path that does not exist yet, its
  nearest existing ancestor is realpath-checked, so a symlinked parent cannot
  redirect a write. _Enforced (file browser + checkpoints)._
- **No check-then-use gap.** Every file operation runs with the process cwd
  pinned to a directory verified inside the root after entering it (Node has
  no `openat`), on bare names only: reads open with `O_NOFOLLOW|O_NONBLOCK`,
  revert writes an `O_EXCL` temp file and `rename()`s it over the target
  (replacing, never following, a symlink), deletion is `unlink()`. A path
  component swapped for a symlink after validation cannot redirect any of
  them. _Enforced._ Known limit: a hardlink to an outside file placed inside
  the root is indistinguishable from a regular file.
- **The renderer never supplies a filesystem root.** `fs:list` / `fs:read`
  take a `projectId` (root from `ProjectStore`); `fs:checkpoint` /
  `fs:snapshot` / `fs:revert` take a `taskId` (root from `TaskStore`). A task's
  `cwd` is validated as an existing directory when the task is recorded
  (`task:create`) — the same bar as `acp:start` — and cannot be changed
  afterwards (store patches are field-whitelisted). _Enforced._
- **Checkpoint content never comes from the renderer.** Main snapshots a file
  when the agent's edit/delete/move tool-call frame arrives and holds it;
  `fs:revert` restores that held copy. Binary or >10 MB files are not
  checkpointed (a UTF-8 round-trip would corrupt them). Limits: in memory only
  (lost on restart), and in `accept_edits` mode the agent may already have
  written by the time the frame arrives — making this exact needs the ACP
  client `fs.writeTextFile` capability. _Enforced, best-effort timing._
- **Every IPC argument is type-checked in main** (`handlers.ts` guards).
  Known gap: the renderer still *chooses* a task/project folder (any existing
  directory), because the New task dialog accepts a typed path.
- **Workers** (Phase 5): each worker runs as an isolated ACP child in the
  coordinator task's `cwd`; its checkpoints resolve through the worker's own
  persisted task record. Cross-profile memory isolation is Hermes' own.

## Approval lifecycle

An approval is raised when Hermes calls `session/request_permission` (surfaced
as `approval-request`) or when a policy bit is absent for a destructive action.

```
        raise
          │
          ▼
      ┌────────┐  user allows   ┌─────────┐
      │ pending├───────────────▶│ allowed │──▶ action proceeds
      │        │                └─────────┘
      │        │  user denies   ┌─────────┐
      │        ├───────────────▶│ denied  │──▶ action refused, turn continues
      │        │                └─────────┘
      │        │  user cancels  ┌───────────┐
      │        ├───────────────▶│ cancelled │──▶ ACP session stopped (Stop button)
      │        │                └───────────┘
      │        │  timeout        ┌─────────┐
      │        ├────────────────▶│ expired │──▶ treated as denied  (not yet enforced)
      └────────┘                └─────────┘
```

Rules:

- **Destructive operations always prompt**, regardless of approval mode
  (`ask` / `auto`). "Auto" only auto-allows non-destructive tool calls.
  The mode is enforced agent-side via ACP session modes. _Enforced._
- **The plan gate is enforced by mode, not just the prompt.** A task always
  runs in `default` until its plan is approved; only then does "auto" switch
  it to `accept_edits`. A re-plan drops it back to `default`
  (`cowork.store.agentModeFor`). _Enforced._ Workers run in `accept_edits`
  (dispatching one is the approval) — _known gap_.
- The app maps an "allow" to ACP `allow_once` — never `allow_always` on the
  user's behalf; if the agent offers no `allow_once`, the request is denied.
  A deny selects `reject_once` (turn continues), falling back to `cancelled`
  (`acp-bridge.permissionOutcome`). _Enforced._
- **Cancellation**: the Stop button calls `acp.stop(sessionId)`, kills the ACP
  child, and records the stop. Any pending approval for that session is
  answered `cancelled` (so a pooled child is not left waiting). _Enforced._
- **Expiry**: a pending approval left unanswered past a timeout is treated as
  denied. _Not yet enforced_ — no timer is armed today; approvals persist until
  answered or the session ends.

## Renderer → main trust boundary

The renderer is treated as untrusted (a compromised page must not be able to
reach the filesystem or the dashboard beyond what the UI needs).

- **No filesystem root from the renderer** — see above; roots come from
  `ProjectStore` / `TaskStore` by id. `ChatSessionStore` holds no folder — a
  chat's `cwd` is derived from its project (or `$HOME`), never sent by the
  renderer.
- **ACP session ownership** — Hermes broadcasts session-scoped frames
  (`session/update`, `session/request_permission`) for every session on a
  HERMES_HOME down every connected ACP client. The bridge forwards or stores
  a frame only if its `sessionId` was opened (or is being loaded) by this app
  on that very child, pooled or isolated; `respondToPermission` re-checks the
  same ownership. A renderer holding a foreign session's ids cannot answer its
  approvals. _Enforced._
- **Profile names** — validated (`isValidProfileName`: one path segment, no
  `.`/`..`/separators) before they touch `HERMES_HOME`, and checked against the
  dashboard's live profile list on `acp:start` / `acp:load`. _Enforced._
- **Explicit `cwd` fails closed** — `acp:start` and `acp:load` reject a
  supplied `cwd` that is not an existing directory; they never silently widen
  scope to `$HOME`. `$HOME` is used only when no `cwd` was given (a chat with no
  project folder). _Enforced._
- **Dashboard REST proxy is allow-listed** — the renderer can only reach the
  exact GET/POST/PATCH/DELETE routes the UI uses; anything else throws. The
  proxy carries the dashboard bearer token, so this is the door. _Enforced._
- **External links** — `setWindowOpenHandler` opens only `http:` / `https:`
  URLs in the OS browser; `file:`, `mailto:`, and custom schemes are dropped.
  `will-navigate` blocks any real navigation off the app origin. _Enforced._

## What the app must never do silently

- Start a task without a user-chosen existing root.
- Write or delete outside the active root.
- Run a shell command or make a network call when the policy bit is unset and
  no inline approval was granted.
- Grant `allow_always` / persistent permission on the user's behalf.
- Kill a Hermes dashboard it did not spawn (`ensureDashboard` returns the child
  only when Cowork owns it).
- Merge one profile's memory into another (Phase 5).
- Claim a rollback/checkpoint that was not actually taken (Task 3.5).
