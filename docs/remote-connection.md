# Remote connection — design note

Status: **implemented (v1, SSH transport)**. Written 2026-09-25 alongside the
implementation. This is Phase 0+1 of [remote-agents-roadmap.md](remote-agents-roadmap.md):
connect this app to a Hermes agent already running on another machine.
Orchestration (a coordinator task driving remote workers) is deliberately out
of scope and comes next.

## Transport decision

**SSH, nothing else.** The ACP framing (`orchestrator/jsonrpc.ts`) is
transport-agnostic — it needs a byte stream in and out, and `ssh` provides
exactly that. SSH reuses trust the user already has between their own machines
(keys, `~/.ssh/config` aliases, agent forwarding) instead of inventing an
auth scheme. Per the roadmap: no socket/TLS/token layer before this proves
out.

The spawned command for a remote session is:

```
ssh -T -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=3 <target> 'HERMES_HOME=<home> exec <binary> acp'
```

- `-T` — no pseudo-terminal. A pty would mangle the length-framed JSON-RPC
  stream (CR/LF translation, echo).
- `BatchMode=yes` — fail fast instead of hanging forever on an interactive
  password prompt. Key-based auth (or an ssh-agent) is required.
- `ConnectTimeout` / `ServerAlive*` — an unreachable host fails in ~10 s, and a
  dropped connection is noticed in ~45 s instead of hanging the task silently.
- `exec` — the remote shell replaces itself with `hermes acp`, so when the
  local ssh process is killed (stopSession / app quit), the connection drops
  and the remote process gets EOF on stdin and exits. No orphaned remote
  Hermes.

## Configuration model

One new optional field, on the **project** (the "host" dimension from the
roadmap's environments section):

```ts
type RemoteOrigin = {
  /** SSH destination: [user@]host or an ~/.ssh/config alias. */
  sshTarget: string;
  /** Remote *global* Hermes home (contains profiles/). Default: ~/.hermes. */
  hermesHome?: string | null;
  /** Remote hermes binary. Default: "hermes" (resolved via remote PATH). */
  binaryPath?: string | null;
};
```

A `CoworkTask` **denormalizes** the project's `remote` at creation time (same
as `cwd` and `profile`), so resuming a task does not depend on the project
still existing or being unedited. Tasks without `remote` behave exactly as
before — local-only is the default and nothing about it changes.

Profile names for remote tasks are resolved against the *remote* home:
`<remoteGlobal>/profiles/<name>`, or the global home itself for `default`.

## What changes where

- **`acp-supervisor.ts`** — `spawn()` no longer hardcodes
  `[binaryPath, 'acp']`. A pure `buildSpawnSpec()` (new
  `orchestrator/spawn-spec.ts`) maps spawn options → `{command, args, env,
  cwd}` for both local and remote cases. Unit-tested in isolation.
- **`acp-bridge.ts`** — the connection-pool key gains the SSH target, so a
  local `anikke` and a remote `anikke` never share a child.
- **`ipc/handlers.ts`** — `acp:start` / `acp:load` accept an optional
  `remote`. When present: the local `isExistingDir(cwd)` check is skipped
  (the path is remote) but the cwd must still be absolute-shaped; the local
  dashboard profile check is skipped (the profile lives on the remote).
  `remote` is validated at the IPC boundary like everything else.
- **Trust boundary** — checkpoints, the file browser, and revert
  (`taskRoot`, `project-fs`) read *local* disk. For a remote task those
  files live on the other machine, so the Fs* channels **refuse remote
  tasks** rather than silently reading/writing the wrong filesystem. The
  renderer hides the Files/Changes tabs for remote tasks.
- **Validation** — `sshTarget` is restricted to `[A-Za-z0-9._@-]` plus
  optional port syntax via ssh config aliases only (no whitespace, no
  leading `-`, no shell metacharacters). Remote paths are single-quote
  escaped. The renderer is untrusted; this is enforced in main.
- **Where the agent runs is never renderer-supplied.** `acp:start` and
  `tasks:create` take a `projectId` and `acp:load` takes a `taskId`; main
  reads the SSH origin from the stored project/task. Only `projects:create` /
  `projects:update` accept a `remote`, and those are the user configuring a
  project.
- **Remote folders** must be plain absolute paths: no `~` (nothing on the
  Hermes side expands it) and no `..` segments.

## Failure semantics

- Unreachable host / auth failure → `ssh` exits non-zero, the supervisor
  emits `exit`, the bridge surfaces a fatal `session-error`. Fail closed,
  no retry storm (a pooled connection that fails initialize is dropped, as
  today).
- Network drop mid-turn → same path: `session-error`, task marked failed.
- Stop → local ssh is killed; `exec` on the far end means the remote agent
  dies with the connection. Verified in e2e.

## Explicit non-goals (this iteration)

- No remote filesystem access (Files/Changes/checkpoints are local-only and
  refuse remote tasks).
- No remote dashboard proxying (Skills/Memory/Kanban of a remote profile).
- No orchestration: one user-driven session per task, no task spawning other
  tasks on remote hosts.
- No new auth: SSH keys are the whole security boundary, documented in
  [security-model.md](security-model.md).
- Chat stays local-only for now; the plumbing is shared, so a remote chat is
  a small follow-up, not new design.

## Remote agents in Chat

Chat can talk to a Hermes profile on another machine. Cowork tasks stay local
by default; a remote *project* (above) is still possible but is no longer the
way to reach a remote agent.

- **A remote agent is its own record** (`remote-agents.json`), not a project:
  `{ name, sshTarget, profile, hermesHome?, binaryPath? }`. Managed on the
  **Remote agents** page (sidebar → Hermes), which also has a **Test
  connection** button — a real handshake, so an ssh failure shows ssh's own
  reason.
- **Chat** shows an **Agent** picker once at least one remote agent exists.
  The choice applies to the next new chat; an existing chat is bound to its
  agent (`ChatSession.remoteId`) and resumes over the same connection.
- **No folder.** Chat is not folder-scoped, so the session's cwd is `.` — the
  remote login directory. No local project or folder is involved.
- **Trust.** The renderer only names an agent id (`acp:start`) or a chat id
  (`acp:load`); main reads the host from the stored record, exactly as for
  remote projects. A chat whose agent was removed fails to resume with a clear
  error instead of silently running locally.
- **Connection pool.** The warm ACP child is keyed by profile, local home, host,
  remote home and remote binary, so two agents on one host never share a child.

