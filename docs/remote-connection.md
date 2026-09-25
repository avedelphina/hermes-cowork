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
  **Remote agents** page (sidebar → Hermes): add, **edit**, remove, and a
  **Test connection** button — a real handshake, so an ssh failure shows ssh's
  own reason. **Find profiles** connects over SSH and lists the profiles on the
  remote (`default` if its Hermes home exists, plus each directory under
  `<home>/profiles`) so the profile is picked, not typed. It runs one fixed
  script (no Hermes started); the target is validated like any other, and only
  the SSH target and optional home/binary come from the form.
- **Editing** an agent changes how its existing chats connect (host, home,
  binary), but a chat keeps the profile it was created under — a session only
  exists in that profile's home.
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

## Deployment variations

SSH is the only transport, so it has to cover how people actually deploy
Hermes. Each variation is a structured, validated field on a remote agent
(**Remote agents → Advanced deployment**); none of them lets the renderer
inject shell. The remote command is always run through `sh -c`, so the login
shell (fish, tcsh) does not matter.

| Deployment | Setting | Remote command (inside `exec sh -c '…'`) |
|---|---|---|
| Plain host, `hermes` on the PATH | – | `HERMES_HOME=$HOME/.hermes[/profiles/<p>] exec hermes acp` |
| Hermes outside the non-login PATH / custom home | binary path, Hermes home | `HERMES_HOME='<home>'[/profiles/<p>] exec '<bin>' acp` |
| Non-default port, key, or via a bastion | SSH port, key file, jump host | adds `-p`, `-i … -o IdentitiesOnly=yes`, `-J` to the ssh call (an `~/.ssh/config` alias works too) |
| Run as another user | Run as user | `exec sudo -n -u <user> -- <bin> acp` |
| Hermes in a container | Container runtime + name | `exec docker exec -i <name> sh -c '…exec hermes acp'` |
| Anything else | Custom command | the command, verbatim |

**Run as another user.** The binary is run *directly* under `sudo -n`, so the
rule on the host can be exactly the command:

```
# /etc/sudoers.d/hermes-acp   (check with: visudo -cf /etc/sudoers.d/hermes-acp)
tomas ALL=(root) NOPASSWD: /usr/local/bin/hermes acp
```

Set the agent's binary path to `/usr/local/bin/hermes` so the command matches
the rule. `-n` makes a missing or wrong rule fail immediately (a
non-interactive ssh cannot answer a password prompt anyway). For the default
profile nothing else is needed: root uses its own `/root/.hermes`.

For a **non-default profile** (e.g. `holly`, which the gateway runs as
`hermes --profile holly gateway run`) the app runs
`sudo -n -u root -- /usr/local/bin/hermes --profile holly acp`. Hermes resolves
`--profile` under the target user's own home, so no environment has to survive
sudo, no home needs setting, and the rule can pin the profile exactly:

```
tomas ALL=(root) NOPASSWD: /usr/local/bin/hermes --profile holly acp
```

Only if you set an explicit remote Hermes home does the app pass it as
`HERMES_HOME` in the environment; sudo then needs
`Defaults!/usr/local/bin/hermes env_keep += "HERMES_HOME"` or it silently
drops it and Hermes falls back to the user's default profile.
(Do not use `sudo … env HERMES_HOME=…`: then sudo runs `env`, and a rule that
lets a user run `env` as root is a root shell.) A tighter alternative is a
root-owned launcher that fixes the home itself, with the sudoers rule and the
agent's binary path pointing at it. Note that the agent then runs its commands
as that user — for root that is as powerful as a root SSH login, minus the root
login.

**Containers.** The command runs inside the container as its default user. The
container's own `HERMES_HOME` is respected (images typically set it, e.g.
`/opt/data`, and have no `~/.hermes`); it is only overridden when you set a
Hermes home or use a non-default profile, in which case the profile home is
derived from the container's environment (`${HERMES_HOME:-$HOME/.hermes}`).
The container runtime runs on the host as the SSH user, so that user needs
access to it (docker group, or combine with *Run as user*). Verified against
Hermes in a docker container: session opens, models list, profiles list, and
stopping leaves no `hermes acp` running inside it.

**Custom command.** For setups the fields do not cover (nix-shell, virtualenv
activation, systemd-run). It is used verbatim, must speak ACP on
stdin/stdout, and replaces the Hermes home, binary, run-as and container
settings (the form refuses the combination). Because it runs arbitrary code on
a remote host with your SSH login, **main asks you to confirm it in a native
dialog showing the exact command** whenever it is saved or the target changes;
a compromised renderer cannot approve it. It exists only on remote agents
(never on projects), and profile listing is unavailable with it.

**Find profiles** works for plain hosts and containers; with *Run as user* or a
custom command it cannot see the profiles, so type the name.

## Not covered (yet)

Transports other than SSH (a relay, WebSocket, or a Hermes-hosted endpoint),
Windows hosts, interactive SSH authentication (password / 2FA prompts — key
or agent auth only), and per-run working folders on a remote (see
[`background-runs.md`](background-runs.md)).

