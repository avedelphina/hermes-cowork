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
  outside the root is rejected. _Enforced (file browser + checkpoints)._
- **The renderer never supplies a filesystem root.** `fs:list` / `fs:read`
  take a `projectId` (root from `ProjectStore`); `fs:snapshot` / `fs:revert`
  take a `taskId` (root from `TaskStore`). A task's `cwd` is validated as an
  existing directory when the task is recorded (`task:create`) — the same bar
  as `acp:start`. _Enforced._
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
  _The mode is currently renderer-only; agent-side enforcement via ACP session
  modes is Task 3.3._
- The app maps an "allow" to ACP `allow_once` — never `allow_always` on the
  user's behalf (`acp-bridge.pickAllowOptionId`). _Enforced._
- **Cancellation**: the Stop button calls `acp.stop(sessionId)`, kills the ACP
  child, and records the stop. Any pending approval for that session is
  dropped. _Enforced._
- **Expiry**: a pending approval left unanswered past a timeout is treated as
  denied. _Not yet enforced_ — no timer is armed today; approvals persist until
  answered or the session ends.

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
