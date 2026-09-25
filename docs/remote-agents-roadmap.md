# Remote agents — roadmap

Status: **Phase 0+1 done** (2026-09-25 — see Phase 0 for results and
[`remote-connection.md`](remote-connection.md) for the as-built design).
Written 2026-09-04 to capture the plan before work
begins, so it can be picked up cold later. This is the spike-first path
toward calling a Hermes profile running on another machine, ahead of any
bigger "team of specialist agents" product decision.

## Why this exists

A local multi-profile GUI is not a strong reason for this app to exist —
plenty of cowork-style clones do that. Being able to call a specialist
profile (review, design, coding, …) running on a *different machine*, from
one task, is the actual differentiator, and the user's stated use case
(already running agents across multiple machines with friends) confirms
real demand, not a hypothetical.

This roadmap only covers proving the transport works. Team/handoff UX is
deliberately out of scope until Phase 0 answers whether it's viable.

## What today's architecture assumes (read before touching anything)

Traced through the actual code, not assumed:

- **One Hermes binary, one global home, for the whole app.**
  `apps/main/index.ts` resolves `ctx.hermesBinary` / `ctx.globalHermesHome`
  once at launch. Every profile is a subfolder of that single home
  (`profileHome(ctx.globalHermesHome, profile)` in
  [`handlers.ts`](../apps/desktop/src/main/ipc/handlers.ts)) — there is no
  concept of a profile living anywhere else.
- **ACP transport is a locally spawned child process over stdio.**
  [`acp-supervisor.ts`](../apps/desktop/src/main/orchestrator/acp-supervisor.ts)
  does `spawn(opts.binaryPath, ['acp'], { cwd, env, stdio: ['pipe','pipe','pipe'] })`
  and talks length-framed JSON-RPC (`jsonrpc.ts`'s `FrameDecoder`/`encodeFrame`)
  over `proc.stdin`/`proc.stdout`. **The framing itself is transport-agnostic**
  — it just needs a byte stream in and out. The only things actually coupled
  to "local child process" are `spawn()` in `acp-supervisor.ts` and the
  hardcoded `['acp']` argv in two call sites in `acp-bridge.ts`.
- **The dashboard (Skills/Memory/Cron/Kanban/Insights, gateway control) is a
  separate REST+WS surface on `127.0.0.1:9119`**, hardcoded in
  [`dashboard.ts`](../apps/desktop/src/main/orchestrator/dashboard.ts) and
  [`kanban-ws.ts`](../apps/desktop/src/main/orchestrator/kanban-ws.ts). This is
  a second, independent thing to make remote — don't conflate it with the ACP
  transport.
- **Folder scope is the trust boundary** ([`security-model.md`](security-model.md),
  principle 1) — checkpoints, file browser, and `resolveWithinRoot` all assume
  the root is a path on *this* machine. A remote task's files live on the
  remote machine; none of that enforcement code reaches them today.
- **Profile names are validated against the local dashboard's live profile
  list** on `acp:start`/`acp:load`. A remote profile won't be in that list.

## Explicit environments — the dimensions today's model conflates

Today a Project is `{ name, profile, optional folder }` — three things,
resolved on one implicit dimension: "local machine, right now." Real usage
(the author already runs agents across several machines — a laptop, home and
cloud servers, and a GPU host) needs five dimensions kept distinct instead of
folded into "the folder":

- **Project** — the user-facing grouping (name + purpose). Already modeled.
- **Repository/source** — which checkout of which repo. Currently assumed to
  be the project's folder; needs to stay separate once a task can run against
  a repo that isn't checked out locally at all.
- **Workspace** — the actual working directory for a given task run
  (`cwd` passed to `spawn()`). Usually == repository root today; won't be
  once checkpoints/file browser reach a remote filesystem (Phase 1 note
  below already flags this).
- **Host** — which machine runs the agent process. Implicit today (always
  "this machine"); Phase 1's "optional remote origin" field on profile
  metadata is what makes this explicit.
- **Agent identity** — which profile/credentials/model config runs, currently
  the only one of the five that's actually a named, first-class concept
  (`profile`).

Phase 1's "extend profile metadata with an optional remote origin" is the
minimum viable version of this: it only makes **host** explicit. Repository
and workspace stay conflated with the local folder until Phase 1's file-
browser/checkpoint question is answered for real (not just "no, not in
v1" — that answer is still the right one for v1, but it's deferring
repository/workspace separation, not avoiding it). Don't design a five-field
config UI now — Phase 0/1 only need the host field; the other four stay
implicit until a concrete use case needs one split out.

## Phase 0 — Spike: prove the transport (do this first, nothing else)

**DONE 2026-09-25.** The argv generalization landed as `orchestrator/spawn-spec.ts`
(`buildSpawnSpec`), SSH is the transport, and the spike graduated into a real
feature: projects carry an optional remote origin, tasks denormalize it, and
the UI surfaces it. See [`remote-connection.md`](remote-connection.md) for the
as-built design. Verified end-to-end against a real host
(`tests/integration/remote-ssh.test.ts`):

- Framing survives an ssh pipe unmodified (handshake, `session/new`,
  `session/prompt`, streamed tokens, `done`) — the `-T` (no pty) flag matters.
- Kill over SSH leaves no orphan: `exec` in the remote command means the
  remote agent dies when the local ssh process is killed.
- Bad target fails closed and fast (`BatchMode=yes` — no password-prompt hang).
- Not proven live: an approval round-trip (the test host's profile had broken
  model auth — HTTP 401 — so the agent never reached a tool call). The
  approval path is the same transport-agnostic code as local and is
  unit-tested; re-run the integration test against a host with working model
  auth to close this out.
- Answer to the spike's real question: **config/plumbing change, not
  rework.** Nothing in ACP's session model leaked local-process assumptions;
  everything above `spawn()` needed no changes beyond passing `remote`
  through and keying the connection pool by SSH target.

Original spike write-up below, kept for context.

Goal: one remote profile, one task, round-trip works. No config UI, no
product surface, throwaway code is fine.

1. Generalize `AcpSupervisor.spawn()` so the command run isn't hardcoded to
   `[opts.binaryPath, 'acp']` — accept an argv the caller builds. For the
   spike, that argv is `['ssh', remoteHost, 'HERMES_HOME=... hermes acp']`
   (or an SSH `ProxyCommand`/config alias). **SSH is the transport for the
   spike, deliberately** — it reuses trust the user already has between their
   own machines (keys, agent forwarding) instead of inventing a new auth
   scheme. Don't build a socket/TLS/token layer before this proves out.
2. Confirm the framing survives an SSH pipe unmodified — stdout/stderr
   ordering, buffering, and backpressure over a network pipe are not
   identical to a local pipe. This is the actual unknown; everything else in
   `acp-bridge.ts` (session pooling, permission routing, model state) is
   transport-agnostic and shouldn't need to change.
3. Manually test: `session/new`, one `session/prompt` turn, an approval
   round-trip (`session/request_permission`), and `stopSession` (kill over
   SSH — does the remote child actually die, or does it orphan?).
4. Write down what broke. This answers the real question: is "remote
   profile" a config/plumbing change, or does ACP's session model leak local-
   process assumptions badly enough to need real rework.

**Side finding, same mechanism (checked 2026-09-11):** the argv
generalization in step 1 also answers a separate question — whether
non-Hermes backends (Claude Code, Codex) need bespoke per-provider
integration or can reuse the ACP path. They can. Per
[agentclientprotocol.com's agent registry](https://agentclientprotocol.com/get-started/agents.md):
Claude Code is exposed as an ACP agent via Zed's SDK adapter ("Claude
Agent"), and Codex CLI via an adapter maintained by the ACP project (not
OpenAI). Neither is native ACP, but both are just another argv for the same `spawn()` — e.g. the
adapter binary in place of `hermes acp` — not a new integration layer. This
means "provider adapter" (Claude/Codex/local models as swappable backends)
is a **local, same-machine instance of this same generalized-argv problem**,
not a separate abstraction to design. Once step 1's argv generalization
lands, trying a non-Hermes provider is "point spawn() at the adapter binary
instead of `hermes acp`" — worth a throwaway local spike alongside or right
after the SSH one, before any adapter abstraction gets designed.

**Exit criteria**: a hardcoded remote profile can complete one full turn with
an inline approval, end-to-end, from this app.

## Phase 1 — Config model (only after Phase 0 works)

- Extend whatever holds profile metadata today (currently just a name
  resolved under the single global `HERMES_HOME`) with an optional remote
  origin: host + how to reach it (SSH alias is enough for v1 — no need for a
  bespoke connection-string format).
- Profile validation (`isValidProfileName` + live dashboard list check) needs
  a remote-aware path: either skip the local dashboard check for remote
  profiles, or query the remote dashboard too (see Phase 2 — this is where
  "just call ACP" and "also want Skills/Memory/Kanban for that profile"
  diverge in cost).
- Decide the MVP boundary explicitly: does a remote task get checkpoints and
  the file browser? Honest default answer is **no, not in v1** — those
  require reaching the remote filesystem, which is a second transport
  problem. Ship chat/prompt turns to a remote profile first; file operations
  are a later phase, not part of proving the concept.

## Phase 2 — Security model update (required before this ships to anyone but the author)

`security-model.md` principle 1 ("folder scope is the trust boundary") was
written for a single-machine trust boundary. Cross-machine changes the
threat model, not just the feature list:

- Who is allowed to call whose agent? (today: nobody, it doesn't exist)
- What does "the app never widens its own scope" mean when scope now spans
  a network boundary the user doesn't directly observe?
- Approval semantics: does a destructive-action approval on a remote task
  still prompt *this* machine's user, or can it silently resolve on the
  remote side? (It must still prompt here — don't let "remote" become a way
  to bypass principle 2, default-deny for destructive actions.)
- SSH already provides transport auth (Phase 0) — document that explicitly
  as the security boundary for v1 rather than leaving it implicit.

This doc needs a new section (or a `remote-security-model.md`) before Phase 1
config work ships to anyone else. Don't skip this because Phase 0's spike
"worked" — a spike proving the pipe works is not a security review.

## Phase 3 — Dashboard-native surfaces for remote profiles (optional, later)

Skills/Memory/Cron/Kanban/Insights for a remote profile means proxying to
*its* dashboard, not just its ACP endpoint. Separate piece of work from
Phase 0–2; don't start it until there's a reason (i.e., someone actually
wants to see a remote profile's memory/kanban from this app, not just run a
task on it).

## Phase 4 — Team/mesh product decision (the "bigger app")

Only after Phase 0 (and ideally Phase 1) prove the mechanics: decide whether
"specialist agents across machines, handoff between them, mimic a team" is
built as a new mode inside this app, or changes the app's positioning enough
to warrant a rename/re-pitch. Chat/Cowork/checkpoints/profile UI from v0.2.0
don't get thrown away either way — they become the single-machine/local-node
experience inside the bigger picture. Don't design this UX before Phase 0
lands; a nice team-of-agents mockup built on an unproven transport is a trap.

## Non-goals for now

- No new auth/token scheme before SSH is proven insufficient.
- No multi-hop routing (agent A calls agent B without the user's app in the
  loop) — out of scope until basic two-machine calling exists.
- No renaming/repositioning the app before Phase 0 has a real result.
