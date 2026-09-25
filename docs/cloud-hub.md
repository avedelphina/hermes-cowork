# Cloud hub — design note

Status: **proposed**, spike 0 done (results in the last section). Written
2026-09-25. This is the "bigger app" step, Phase 4 of
[remote-agents-roadmap.md](remote-agents-roadmap.md): Cowork across several
machines, with a dashboard and an API that a web page and an iOS app can use.

## Goal

- **Self-hosted, one user per install.** The app is public (anyone can run it),
  but each hub serves one owner and that owner's devices. No multi-tenant
  service, no user table.
- **A running task keeps running** whatever happens to the desktop app, the hub,
  the phone or the network. It stops only when the user stops it, the agent
  finishes, or the agent's machine goes down.
- **One API for every client.** The desktop app, a web dashboard and an iOS app.
  The phone starts with approving and monitoring; starting tasks and chat come
  later.

## What Hermes already provides, and why it is not enough

Upstream Hermes (0.21.3) already ships most of a "gateway": a Docker image with
the gateway and dashboard under s6, `hermes serve` (a WebSocket backend that
refuses a public bind without a password or OAuth), the api_server **Runs API**
(start, stream, approve, stop), a desktop app that connects to many machines
(local, remote URL, SSH, Hermes Cloud), a kanban board and peer messaging. We
do not rebuild any of that.

What only Cowork has is the plan-then-approve flow, inline approvals, projects
scoped to a folder, and running one task across several machines. Those need a
home that outlives any one client.

The Runs API looked like the obvious way to make runs durable. The earlier
background-runs spike (`docs/background-runs.md`, branch `docs/background-runs`,
not merged) found three blockers:

1. No per-run working folder. Cowork's trust boundary is the task folder
   ([security-model.md](security-model.md), principle 1).
2. The event stream can be read once. After a client drops, only status and the
   final transcript remain; there is no live stream after a re-attach.
3. Runs live in the gateway process and are `interrupted` when it restarts.

It is also Hermes-only, while ACP keeps the door open to Claude Code and Codex
through their ACP adapters (the roadmap's side finding). So we keep ACP and make
the ACP pipe itself durable: `cowork-pipe`, below.

## Where the logic lives today

- **Main process:** stores, ACP bridge and supervisor. Only `index.ts`,
  `ipc/handlers.ts`, `orchestrator/kanban-ws.ts` and `update/updater.ts` import
  Electron; the rest is plain Node and can move as-is.
- **Renderer:** the task state machine and the plan gate
  (`agentModeFor`, `syncAgentMode`, `persistTask` in
  [`cowork.store.ts`](../apps/desktop/src/renderer/features/cowork/cowork.store.ts)).
  With one window this is fine. With
  several clients it is a correctness and a security problem: two clients race
  each other, and a client that does not reimplement `agentModeFor` skips the
  plan gate. This logic moves to the server before a second client exists.

## Architecture

```
 iPhone (PWA, later native)     browser      desktop (embedded core, or hub mode)
          └──────────── HTTPS: POST /rpc + GET /events (SSE) ────────────┘
                                    │
          ┌─ hub (Docker) ──────────┴───────────────────────────────┐
          │ core: projects, tasks, plan gate, approval queue,       │
          │       fan-out, push; serves the web UI                  │
          │ front: tailscale serve | caddy | cloudflared            │
          └──────────────┬──────────────────────────────────────────┘
                         │ ssh  →  cowork-pipe attach <run> <offset> -- <agent>
        ┌────────────────┼─────────────────┐
   homelab Hermes    GPU box Hermes    laptop Hermes (sleeps: a poor agent host)
   each run: cowork-pipe daemon → hermes acp, output recorded on that host
```

A star. Clients only talk to the hub. The hub reaches agent hosts over SSH, the
transport that already works ([remote-connection.md](remote-connection.md)).
Each run lives in a small daemon on its agent host, so nothing the hub does, or
fails to do, stops it.

## Durable runs: `cowork-pipe`

[`apps/pipe/cowork-pipe.py`](../apps/pipe/cowork-pipe.py) is one Python file,
standard library only (every Hermes host already has Python).

```
cowork-pipe attach <run-id> <offset> [-- <agent argv...>]
cowork-pipe stop <run-id>
```

- `attach` starts the agent under a detached daemon (its own session) when the
  run has none, then relays stdin to the agent and the agent's stdout to stdout.
  The daemon appends everything the agent prints to
  `~/.cowork/runs/<run-id>/frames`.
- The client can die at any moment. The agent keeps running, and the daemon
  keeps recording.
- `<offset>` is the number of output bytes the caller has already processed,
  always at a line end. A re-attach gets the rest of the record, then the live
  stream: nothing lost, nothing twice. Byte offsets rather than frame numbers
  make resuming a single `seek`, and blank or non-JSON lines cannot throw the
  count off.
- **One run id is one agent process, ever.** Attaching to a run whose agent has
  gone replays what is left and exits. It never starts a second agent.
- **The newest attach wins.** The previous client is detached, so the agent has
  one writer. A frame that a client only half sent before it died is dropped;
  the agent only ever receives complete lines.
- `stop` closes the agent's stdin, then sends SIGTERM after 1 s and SIGKILL after
  5 s (the same sequence as `AcpSupervisor.shutdown`), and returns when the
  agent is gone.
- Client exit status: the agent's own once it has exited (128+N for signal N);
  75 when the run died with no record of how (host reboot, daemon killed); 0
  when detached while the agent still runs, and the hub simply attaches again.
- If the run directory is removed while the agent runs (someone clears
  `~/.cowork`), the daemon stops the agent within about a second. Otherwise the
  agent would keep running where nothing can reach or stop it.
- No fsync. The record only has to outlive the client and the hub; a power cut
  kills the agent too. The run directory is 0700, so only the owner can reach
  the socket.

### What changes when the hub adopts it (phase 1)

- **Spawn:** `buildSpawnSpec` wraps the existing launch command. The remote
  command becomes `cowork-pipe attach <run> <offset> -- sh -c '<launch script>'`.
  This covers the plain, run-as and custom-command variants unchanged.
- **Run id:** task id plus attempt number. A resumed task gets a new run.
- **Offset:** the hub persists, per run, the bytes of complete lines it has
  processed. `FrameDecoder` returns parsed messages and silently skips blank
  and malformed lines, so counting messages is not enough: it must also report
  the bytes of the complete lines it consumed.
- **Re-attach in the bridge:** no second `initialize` or `session/new`; the
  session id comes from the stored task. A response that matches no pending
  request (the hub restarted during `session/prompt`) means the turn ended.
  Pending approvals are persisted in the hub, so an approval raised before a
  restart can still be answered. Request ids are already `randomUUID()`
  (`acp-supervisor.ts`), so ids cannot collide across hub restarts.
- **Stop changes meaning.** Today killing the ssh process kills the remote agent
  ("no orphaned remote Hermes"). With the pipe, killing ssh only detaches. The
  Stop button must call `cowork-pipe stop` over its own ssh command, and
  [remote-connection.md](remote-connection.md) must be updated to say so.
- **Local tasks** use the same pipe. Quitting the desktop app then leaves the
  task running instead of marking it `interrupted`, which is the "continue in
  the background" choice from the background-runs quit dialog, without the Runs
  API.
- **Housekeeping:** the hub lists and reconciles runs on each host at start-up,
  and removes finished runs after a while. Not built yet.

### Known limits

- ⚠ **Hermes rejects a pending approval after `approvals.timeout`.** The ACP
  adapter waits that long for the client's answer, then treats it as a denial
  (`acp_adapter/permissions.py`). The default in code is 300 s; the root and
  `anikke` profiles on the author's machine set 60 s. Approving from a phone
  hours later needs a much longer timeout (for example 86400) on the profiles
  Cowork uses. Still to check: whether timeouts count towards
  `approvals.denial_breaker_threshold`.
- **Host reboot or Hermes crash** kills the turn in progress; attaching then
  exits 75. The hub resumes with `session/load` plus a "continue" prompt on a new
  run. A tool call that was in progress may run twice.
- **Linux:** on distributions with `KillUserProcesses=yes`, ending an ssh session
  kills every process started from it, even in a new session. There the pipe
  must be started with `systemd-run --user` and the user needs
  `loginctl enable-linger`. On macOS, the pipe's own session is enough.
- **Containers:** the pipe runs on the host and wraps `docker exec -i`, which
  needs `python3` on the host. The alternative is running it inside the
  container (`$HERMES_HOME/bin`), where it lives as long as the container. Open.
- The replay streams from disk in chunks, bounded by the same 64 MB backlog
  limit as the live stream; a client that falls behind is dropped and
  re-attaches from disk.

## The hub

- **Core:** `packages/core` takes the main-process orchestrator and stores plus
  the renderer's task state machine. The desktop app embeds it (local-first
  stays the default, no hub needed); the hub container runs the same code.
- **API:** the existing `IpcChannel` contract, over two endpoints and plain
  `node:http`:
  ```
  POST /rpc     {"method":"task:create","params":{...}}  → result
  GET  /events  Server-Sent Events; Last-Event-ID replays missed events
  ```
  SSE rather than WebSocket: browsers have `EventSource` built in, a phone that
  was in the background catches up through `Last-Event-ID`, and it is the same
  shape as the Runs API. No new dependency.
- **State:** the existing JSON stores are enough while the hub is the only
  writer. It adds per-run offsets, pending approvals and push subscriptions.
  SQLite when that stops being true.
- **Web dashboard:** the hub serves the React renderer. The `window.hermes`
  preload is replaced by a thin fetch plus `EventSource` shim.
- **While the hub is down,** running agents carry on. Only the UI, approvals and
  starting new workers wait.

## Auth and exposure

- **Device pairing.** The first device uses a one-time code from `docker logs`;
  later devices scan a QR shown on a paired device. Each device gets a random
  token; the hub stores only its hash, and each device can be revoked alone. No
  passwords, OAuth or user table.
- The hub listens on 127.0.0.1 only. A compose profile chooses the front:
  - `tailscale` (default): `tailscale serve`, a real HTTPS certificate, nothing
    public. The ACL must allow users only port 443 on the hub; otherwise a
    direct connection to the hub's port can fake the `Tailscale-User-Login`
    identity header.
  - `caddy`: your own domain, automatic TLS.
  - `cloudflared`: public HTTPS without forwarding a port.

## Phone

- **First: a PWA** served by the hub: task list, live transcript, approval card,
  Stop. It reuses the renderer's components with a mobile layout.
- **Push: Web Push** with VAPID keys generated by each hub, so there is no
  central server. It needs iOS 16.4 or later, the app added to the Home Screen,
  and HTTPS. The payload is end-to-end encrypted (RFC 8291); Apple sees nothing.
  Use the `web-push` package rather than hand-written RFC 8291 crypto.
- **Later, a native app** needs APNs, and the APNs key cannot ship to
  self-hosters. That requires one central relay we run, forwarding encrypted
  notifications it cannot read (the pattern Matrix and Nextcloud use). It is
  the only central service in this design, and the PWA avoids it until then.

## Security

- The hub holds SSH keys to every agent host, which makes it the main target.
  Each host restricts the hub's key with `restrict,command="cowork-pipe --ssh"`
  in `authorized_keys`. In that mode the pipe starts only agents named in a
  host-local allow-list and never takes an argv from the hub. For the same
  reason the hub must not be able to update the pipe: installing and updating
  it is the user's one-line script, and the hub only reports a version
  mismatch. (`--ssh` is not built yet; the spike version accepts an argv.)
- The plan gate and approval expiry are enforced in the hub, not in clients.
  Each approval records which device answered it. The first answer wins, and
  the other clients see it resolved.
- Model API keys stay on the agent hosts. The hub never holds them.
- Later: the pipe checks a device signature on every "allow" response and every
  switch to `accept_edits`. A compromised hub could then relay, but not approve.
- The roadmap's Phase 2 (remote security model) must be written before a
  release. It is no longer optional.

## Docker

```yaml
services:
  ts:
    image: tailscale/tailscale
    hostname: cowork
    environment: [TS_AUTHKEY, TS_STATE_DIR=/var/lib/tailscale, TS_SERVE_CONFIG=/config/serve.json]
    volumes: [ts-state:/var/lib/tailscale, ./serve.json:/config/serve.json:ro]
  hub:
    image: ghcr.io/avedelphina/hermes-cowork-hub   # node:22-slim + openssh-client + core + web UI
    network_mode: service:ts                       # reachable only through the tailnet
    volumes: [hub-data:/data, ./ssh:/home/node/.ssh:ro]
volumes: { ts-state: {}, hub-data: {} }
```

A multi-arch image (VPS, Raspberry Pi, homelab), built by the existing release
workflow. The `caddy` and `cloudflared` profiles replace the `ts` service.
Agent hosts run upstream Hermes, in its Docker image or natively.

## Phases

0. **Spike `cowork-pipe`.** Done, see below.
1. **Core.** Extract `packages/core`, move the plan gate and task state out of
   the renderer, add re-attach to the bridge, run local tasks through the pipe.
   This pays off even without a hub: tasks survive quitting the app.
2. **Hub.** Container with `POST /rpc` and `GET /events`, pairing, the web UI,
   the GHCR image and the compose profiles. `cowork-pipe --ssh` and the install
   script.
3. **Phone.** PWA with Web Push, approving and monitoring.
4. **Native iOS** and the push relay: the full phone.

## Non-goals

Kubernetes, Postgres, a message bus, a custom auth provider, several users per
hub, agents calling each other without the hub, and remote Files/Changes
(later: workers commit to a branch and the hub shows `git diff`).

## Spike 0 results

Question: can an ACP run outlive its client, and resume without losing or
repeating anything? Run 2026-09-25 on macOS with
[`tests/integration/cowork-pipe.test.ts`](../apps/desktop/tests/integration/cowork-pipe.test.ts).

**Confirmed with a scripted agent** (6 tests, about 3 s, part of `pnpm -r test`;
they need `python3`; 10 runs in a row all passed):

- Killing the client with SIGKILL leaves the agent running and recording.
- Re-attaching at the processed offset continues the stream. The frames before
  and after the crash together equal the record exactly, and a numbered
  sequence arrives complete and in order.
- An approval request raised while no client was attached is replayed, answered
  through the new client, and the turn completes.
- A half-sent frame from a dead client never reaches the agent.
- `stop` ends the agent. A finished run replays its whole record and reports the
  exit code without starting anything.
- A run whose daemon died exits 75 on attach and is never restarted.
- A newer attach takes over, and the old client exits 0. So does a client whose
  stdin is closed; the agent keeps running.
- An attach that lands while the daemon is still starting waits for it instead
  of reporting the run interrupted.
- Removing a live run's directory stops its agent.
- Checked once by hand that the tests catch real bugs: forwarding partial
  frames fails the half-frame test, and replaying from offset 0 fails the
  resume test.

**Confirmed with real Hermes** (0.21.3, `HERMES_PIPE_TEST_REAL=1`, the `anais`
profile on OpenRouter):

- A streaming turn with the client crashed 10 frames in: 117 more frames after
  the re-attach, the turn ended normally, and the record matched exactly.
- A file-edit approval (a new ACP session is in `default` mode, "Ask before
  edits") was raised while no client was attached. It was answered after
  re-attaching, and the file was written.

**Found and fixed during the spike**

- A daemon killed with SIGKILL can still accept a connection for a moment: the
  kernel may close the clients' sockets before the listener. A client that
  checked "is the daemon alive?" by connecting took that as a takeover and
  exited 0 instead of 75. The check is now a `ping` that needs an `ok` answer.
- Deleting a run directory while its daemon was alive left the agent running
  with no way to stop it through the pipe. Hence the removed-directory check.
- The first real run seemed to hang. The cause was the model provider returning
  HTTP 403 (quota) and the test looking in the wrong place, not the pipe. When a
  real run misbehaves, `~/.cowork/runs/<run>/stderr` holds Hermes' log.

**Found and fixed in review**

- A second attach landing between the run-dir lock and the daemon's `sock`
  bind got a refused connect with no `exit` file and reported the run
  interrupted (75) — a run that was alive and still starting. Connect now
  waits while neither `sock` nor `exit` exists (covered by a test).
- An argv-less attach to a nonexistent run created the run dir (the lock) and
  then removed it on the way out, so it could delete a dir a racing attach had
  just claimed. It now refuses without claiming anything.
- The replay at attach read the whole record into memory; the 64 MB backlog
  cap only applied to the live stream. Replay now streams from disk in
  chunks under the same cap.

**Not verified yet**

- An ssh hop. Remote Login is off on the test machine; SSH itself is proven as a
  byte pipe in [remote-connection.md](remote-connection.md). Run the scripted
  suite through `ssh <host>` next.
- The Linux `KillUserProcesses` behaviour, and the container variant.
- Recovery after a host reboot (`session/load` plus "continue").
- Long runs near the 64 MB backlog limit.

**Effect on the design:** the durable pipe works without changes to Hermes or to
ACP. The hub can restart and clients can come and go while turns and approvals
carry on. Next is phase 1.
