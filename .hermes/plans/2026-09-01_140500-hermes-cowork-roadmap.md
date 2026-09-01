# Hermes Cowork Roadmap

> For Hermes: use this roadmap as the product and implementation baseline. Implement in small, independently verified slices.

**Goal:** Turn the current Hermes Cowork Electron prototype into a dependable, Claude-Cowork-style desktop workspace for Hermes Agent, with project folders, resumable tasks, visible plans, approvals, artifacts, profile isolation, and safe local execution.

**Architecture:** Keep Hermes Agent as the execution and state authority. Hermes Cowork remains a thin Electron/React presentation layer using ACP for active agent sessions and the Hermes dashboard APIs for profiles, sessions, Kanban, skills, memory, cron, and gateway state. Do not duplicate Hermes state in the renderer unless it is explicitly UI cache.

**Current baseline:** `frabbi0942/Hermes-Cowork`, fork target `avedelphina/hermes-cowork`; macOS Apple Silicon; Hermes Agent 0.20.6; profile-scoped `HERMES_HOME` at `/Users/avedelphina/.hermes/profiles/anikke`; Azure Foundry model-router. Current source tests, typecheck, and production build pass. The app launches after manually repairing the Electron package download.

---

## Product definition

A proper first release should let Tom:

- create and switch between projects
- associate each project with a real local folder
- give Hermes persistent project instructions and context
- start a task in Chat, Cowork, or Code mode
- see the plan before execution
- approve, reject, pause, redirect, or cancel work
- observe tool calls, file changes, subprocesses, and progress
- inspect artifacts and diffs before accepting them
- resume tasks after restarting the app
- select the correct Hermes profile without profile data leaking
- work safely inside an explicitly approved folder
- receive honest failure and recovery state

Claude-Cowork-like features that are deliberately deferred: cloud execution, mobile clients, multi-human collaboration, SaaS connectors, billing, and a new project-management backend. Multi-agent collaboration is not deferred: it is a core Hermes-native capability and a release requirement, introduced after single-agent execution is reliable.

---

# Phase 0 — Baseline, packaging, and safety contract

### Task 0.1: Make the development install reproducible

**Files:**
- Modify: `package.json`
- Modify: `apps/desktop/package.json`
- Modify: `README.md`
- Add/update: package-manager configuration as needed

**Work:** Pin and document the supported Node/pnpm versions; make Electron post-install/download behavior reliable on macOS; add a clean-install instruction; ensure no generated `node_modules` or local caches enter Git.

**Validation:** Remove dependencies in a disposable clone, run install, build, and launch successfully without manually editing Electron metadata.

### Task 0.2: Add runtime diagnostics

**Files:**
- Modify: `apps/desktop/src/main/orchestrator/hermes-runtime.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/shell/StatusBar.tsx`
- Test: `apps/desktop/tests/unit/hermes-runtime.test.ts`

**Work:** Display detected Hermes binary, version, profile home, dashboard status, ACP status, and actionable errors. Never show a green/ready state until the relevant probe succeeds.

**Validation:** Test missing Hermes, incompatible Hermes, dashboard failure, and successful startup.

### Task 0.3: Define the security and approval contract

**Files:**
- Add: `docs/security-model.md`
- Modify: `apps/desktop/src/shared/types.ts`
- Add tests for folder permission and approval state

**Work:** Define read/write/delete/network/terminal permissions, approval semantics, cancellation behavior, and what the app must never silently do. Use default-deny for destructive actions and explicit folder scope.

**Validation:** Documented state transitions and tests for denied, approved, cancelled, failed, and expired approvals.

---

# Phase 1 — Correct Hermes integration

### Task 1.1: Fix profile and `HERMES_HOME` resolution

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/ipc/handlers.ts`
- Modify: `apps/desktop/src/main/orchestrator/acp-supervisor.ts`
- Modify: `apps/desktop/src/main/orchestrator/dashboard.ts`
- Test: profile-resolution and supervisor unit tests

**Work:** Distinguish the global Hermes home from a profile home. Resolve `default` and named profiles from the actual global home, not by blindly appending `profiles` to an already profile-scoped `HERMES_HOME`. Pass the resolved profile home explicitly to every ACP/dashboard child.

**Acceptance:** Selecting `anikke` resolves exactly `/Users/avedelphina/.hermes/profiles/anikke`; no `profiles/anikke/profiles/anikke` path is possible.

### Task 1.2: Make active-profile state truthful

**Files:**
- Modify: `apps/desktop/src/renderer/shell/ProfileDropdown.tsx`
- Modify: `apps/desktop/src/renderer/shell/StatusBar.tsx`
- Modify: `apps/desktop/src/shared/types.ts`
- Test: profile UI/store tests

**Work:** Load the actual active profile from Hermes, initialise the UI from it, and show the resolved profile path/model/provider. Do not label a profile `default` merely because the renderer has not loaded state yet.

### Task 1.3: Exercise ACP against Hermes 0.20.6

**Files:**
- Modify: `apps/desktop/src/main/orchestrator/acp-translator.ts`
- Modify: `apps/desktop/src/main/orchestrator/acp-bridge.ts`
- Add: integration test harness or recorded ACP fixtures

**Work:** Verify handshake, prompt, streaming text, tool calls, approval requests, cancellation, shutdown, errors, and file-diff events against the installed Hermes version. Version-gate unsupported protocol behavior.

**Acceptance:** A real ACP session can start, answer, call a harmless tool, be interrupted, and shut down cleanly.

### Task 1.4: Make dashboard lifecycle non-destructive

**Files:**
- Modify: `apps/desktop/src/main/orchestrator/dashboard.ts`
- Add/update: dashboard lifecycle tests

**Work:** Detect an existing dashboard, reuse it when compatible, avoid killing a dashboard not owned by the app, select a free loopback port, and clean up only child processes started by Cowork.

---

# Phase 2 — Projects and local workspaces

### Task 2.1: Add persistent project metadata

**Files:**
- Add: `apps/desktop/src/main/store/project-store.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Add: project schema and unit tests

**Work:** Store project ID, name, folder path, selected profile, instructions file, permission policy, and last-used session. Use Electron Store or a small local database; do not copy project files into app state.

### Task 2.2: Implement project creation and switching

**Files:**
- Add/modify: `apps/desktop/src/renderer/features/projects/*`
- Modify: `apps/desktop/src/renderer/shell/Sidebar.tsx`
- Modify: `apps/desktop/src/renderer/routes.tsx`

**Work:** Add project list, create-from-folder, rename, archive, remove-from-app, and switch flows. Removing a project must not delete its folder.

### Task 2.3: Add safe folder picker and permissions

**Files:**
- Modify: Electron main IPC handlers
- Add: folder permission store and tests
- Modify: Cowork new-task dialog

**Work:** Request folder access explicitly. Show the exact resolved path and permissions before execution. Reject paths outside the approved project root unless the user grants a separate scope.

### Task 2.4: Load project context

**Files:**
- Add: project-context loader
- Modify: ACP prompt/session startup
- Add: `docs/project-context.md`

**Work:** Support `AGENTS.md`, `.hermes.md`, and a project instruction file with clear precedence. Pass context through the supported Hermes mechanism rather than mutating global identity or profile memory.

### Task 2.5: Build the file browser and preview pane

**Files:**
- Add/modify: `apps/desktop/src/renderer/features/files/*`
- Add: path validation and file API tests

**Work:** Browse only the selected project root; preview text, Markdown, images, PDFs, and common office artifacts where supported; reveal diffs and changed files; prevent path traversal.

---

# Phase 3 — Cowork task lifecycle

### Task 3.1: Make task creation real and resumable

**Files:**
- Modify: `apps/desktop/src/renderer/features/cowork/NewTaskDialog.tsx`
- Modify: `apps/desktop/src/renderer/features/cowork/cowork.store.ts`
- Modify: ACP bridge/session persistence
- Tests: Cowork store and integration tests

**Work:** Persist task identity, project, profile, folder, ACP session, goal, and status. Restore an interrupted task as recoverable instead of silently creating a fresh session.

### Task 3.2: Fix the Cowork composer and steering

**Files:**
- Modify: `apps/desktop/src/renderer/features/cowork/CoworkPage.tsx`
- Modify: `apps/desktop/src/renderer/features/chat/Composer.tsx`
- Modify: ACP bridge
- Tests: composer/bridge tests

**Work:** Route follow-up messages to the active Cowork ACP session, not the chat store’s null session ID. Support redirect, clarification, pause, resume, cancel, and retry.

### Task 3.3: Implement plan mode

**Files:**
- Modify: `PlanTab.tsx`, `GoalHeader.tsx`, `ApprovalCard.tsx`
- Modify: Cowork system/prompt construction
- Add: plan-state tests

**Work:** Represent plan proposal, approval, execution, modification, completion, and failure. Make “Ask before acting” enforceable, not a renderer-only toggle. Destructive operations always require approval.

### Task 3.4: Scope Kanban/task events

**Files:**
- Modify: `apps/desktop/src/main/orchestrator/kanban-ws.ts`
- Modify: `PlanTab.tsx`, `SubtasksTab.tsx`, `cowork.store.ts`
- Tests: event filtering and parent/child task linkage

**Work:** Associate Kanban events with a parent task/session/project and ignore unrelated profile events. Connect observed `kanban_create` output to `parentTaskId`.

### Task 3.5: Add artifacts, diffs, and checkpoints

**Files:**
- Modify: `ArtifactsTab.tsx`, `Transcript.tsx`
- Add: artifact index/checkpoint store
- Add: diff and rollback tests

**Work:** Track files read/written/created/deleted, render diffs, provide open/reveal actions, and create checkpoints before risky multi-file changes where practical. Do not claim rollback unless it is actually implemented and verified.

---

# Phase 4 — Daily-use quality

### Task 4.1: Improve Chat and Code modes

**Files:** `features/chat/*`, new/modified `features/code/*`

**Work:** Resumable chat sessions, project-aware Code mode, file tree, diff viewer, test output, and consistent profile/project selection.

### Task 4.2: Add session/task history

**Files:** session list/store/routes and tests

**Work:** Search and filter by project, profile, date, status, and task. Reopen completed, failed, and interrupted work with clear state.

### Task 4.3: Add background execution and notifications

**Files:** task supervisor, notification IPC, settings UI

**Work:** Allow a task to continue while the window is hidden, show progress and failure notifications, and make shutdown/restart behavior explicit. Do not implement unattended destructive work without a policy and approval record.

### Task 4.4: Add error recovery and observability

**Files:** runtime status, logs panel, error components, tests

**Work:** Surface ACP crashes, dashboard disconnects, provider errors, expired approvals, partial outputs, and restart options. Preserve transcripts and artifacts on failure.

### Task 4.5: Accessibility and visual polish

**Work:** Keyboard navigation, focus handling, screen-reader labels, responsive pane layout, readable tool traces, light/dark themes, and no Anthropic visual copying.

---

# Phase 5 — Multi-agent collaboration and Hermes-native depth

Multi-agent work is a first-class product feature, not merely an implementation detail. A Cowork task may be decomposed into parallel subtasks assigned to distinct Hermes profiles or specialist workers, with the coordinator retaining responsibility for the overall plan, approvals, synthesis, and final delivery.

### Task 5.0: Define the multi-agent execution model

**Files:**
- Add: `docs/multi-agent-model.md`
- Modify: `apps/desktop/src/shared/types.ts`
- Add: multi-agent state and routing tests

**Work:** Define coordinator, worker, and reviewer roles; task ownership; profile and workspace isolation; parent/child task relationships; message routing; cancellation; retries; failure handling; approval authority; artifact ownership; and final-result synthesis. Make explicit which state is shared and which remains profile-scoped.

**Acceptance:** A task can show a coordinator plus multiple workers with independent status, profile, working directory, transcript, artifacts, and failure state. No worker can silently write outside its approved project scope or inherit another profile’s private memory.

### Task 5.1: Implement worker dispatch and supervision

**Files:**
- Add/modify: `apps/desktop/src/main/orchestrator/worker-supervisor.ts`
- Modify: `apps/desktop/src/main/orchestrator/acp-supervisor.ts`
- Modify: `apps/desktop/src/main/ipc/handlers.ts`
- Add: supervisor and lifecycle tests

**Work:** Spawn multiple ACP/Hermes workers with explicit profile, project, cwd, permissions, and task IDs. Track heartbeats, readiness, completion, cancellation, crashes, retries, and stale workers. Do not silently restart failed work.

### Task 5.2: Build the multi-agent task view

**Files:**
- Modify: `apps/desktop/src/renderer/features/cowork/SubtasksTab.tsx`
- Modify: `apps/desktop/src/renderer/features/cowork/RightPane.tsx`
- Modify: `apps/desktop/src/renderer/features/cowork/GoalHeader.tsx`
- Add: worker detail view and tests

**Work:** Show the coordinator and worker graph, current activity, profile/role, progress, tool calls, approvals, artifacts, blockers, and output. Let Tom open a worker transcript, pause/cancel a worker, or redirect a subtask without losing the parent task context.

### Task 5.3: Add dependency-aware scheduling

**Files:**
- Modify: task/plan state and Kanban event handling
- Add: scheduler tests

**Work:** Support parallel independent subtasks, dependent subtasks, bounded concurrency, priority, retries, and blocked state. Prevent the coordinator from marking the parent complete while required workers are still running or failed.

### Task 5.4: Add synthesis and review stages

**Files:**
- Modify: Cowork task lifecycle and artifact store
- Add: synthesis/review tests
- Add: `docs/multi-agent-model.md` review protocol

**Work:** Collect worker outputs with provenance, run an optional reviewer worker, present conflicts and unresolved questions, and require coordinator/user acceptance before finalising the parent task. The UI must distinguish worker claims from verified artifacts and test results.

### Task 5.5: Add multi-agent cost and resource controls

**Files:**
- Modify: settings and task policy surfaces
- Add: resource-policy tests

**Work:** Configure maximum workers, model/profile selection, timeout, token/cost budget where available, filesystem permissions, network permissions, and whether workers may spawn further workers. Default to bounded, explicit concurrency.

### Task 5.6: Profile manager

Create/clone/export/import profiles only after verifying the current Hermes profile APIs. Keep destructive profile operations behind confirmation and never assume profile deletion means deleting its files.

### Task 5.7: Skills, memory, cron, gateway, and insights surfaces

Expose existing Hermes capabilities as read-first UI surfaces. Mutations must use Hermes APIs, show scope, and read back the result. Keep Anikke’s private profile and team/shared state visibly distinct.

### Task 5.3: Multi-agent fanout

Add profile fanout only after single-agent task isolation is reliable. Show each child’s profile, folder, status, output, and failure independently; never merge memory implicitly between agents.

---

# Phase 6 — Release engineering

- Add CI for lint, typecheck, unit tests, build, and macOS packaging.
- Produce signed/notarised Apple Silicon DMG; later Intel, Windows, and Linux packages.
- Add upgrade/migration handling for local app metadata.
- Add crash-safe shutdown and stale-child cleanup.
- Write operator documentation for profile setup, project permissions, troubleshooting, and recovery.
- Create a release checklist with clean-machine installation and a real Hermes integration smoke test.
- Establish upstream sync policy and keep the fork’s changes in small reviewable commits.

---

# Definition of done for the first useful release

A clean install can:

1. Detect Hermes and the configured profile correctly.
2. Create a project from a local folder without copying or deleting files.
3. Start a Cowork task using the selected profile and project folder.
4. Show a plan and wait for approval before execution.
5. Stream text and tool activity.
6. Execute a harmless file task inside the approved root.
7. Show changed files and a usable diff.
8. Accept a follow-up instruction in the same task.
9. Survive a window restart and offer task resumption.
10. Keep unrelated profiles/projects/tasks isolated.
11. Run at least two bounded worker subtasks in parallel, show their independent progress, and synthesise their outputs with provenance.
12. Report failures honestly and preserve evidence.

# Risks and open decisions

- ACP and dashboard APIs may change; upstream compatibility should be tested rather than assumed.
- The app must decide whether it owns a dashboard process or attaches to a user-managed one.
- Local file permissions and macOS privacy prompts need testing on a clean machine.
- Kanban may be useful as an execution view but should not become a second source of truth.
- Persistent project memory must not leak into global or shared Honcho memory.
- The precise fork destination and upstream-sync workflow still need confirmation.
