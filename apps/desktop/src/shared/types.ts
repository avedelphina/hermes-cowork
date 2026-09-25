// Dashboard-derived types (ProfileSummary, Status) live in the renderer's
// api/schemas.ts as Zod schemas — they are only consumed there.

/**
 * How to reach a Hermes agent on another machine. v1 transport is SSH only —
 * see docs/remote-connection.md. The agent runs as `hermes acp` on the far
 * end of an ssh pipe; SSH keys are the entire auth boundary.
 */
export type RemoteOrigin = {
  /** SSH destination: [user@]host or an ~/.ssh/config alias. */
  sshTarget: string;
  /** Remote *global* Hermes home (the dir containing profiles/). Default: ~/.hermes. */
  hermesHome?: string | null;
  /** Remote hermes binary. Default: "hermes" from the remote PATH. */
  binaryPath?: string | null;
  // ── how to reach it (ssh flags; an ~/.ssh/config alias covers these too) ──
  /** SSH port (`-p`). */
  port?: number | null;
  /** Local private key (`-i`), absolute or `~/…`. */
  identityFile?: string | null;
  /** Jump host(s) (`-J`), comma-separated `[user@]host[:port]`. */
  proxyJump?: string | null;
  // ── who / where it runs on the remote ──
  /** Run hermes as this user via `sudo -n -u <user>`. The remote needs a matching sudoers rule. */
  runAs?: string | null;
  /** Hermes lives in a container on the remote: `<runtime> exec -i <name> …`. */
  container?: { runtime: 'docker' | 'podman'; name: string } | null;
  /** Escape hatch: the whole remote command, verbatim. Remote agents only, user-confirmed. */
  command?: string | null;
};

export const CONTAINER_RUNTIMES = ['docker', 'podman'] as const;

/** What the Remote agents form sends: a name, a profile, and the origin fields. */
export type RemoteAgentInput = { name: string; profile: string } & RemoteOrigin;

/** A Hermes profile on another machine, reached over SSH (see RemoteAgentStore). */
export type RemoteAgent = {
  id: string;
  name: string;
  sshTarget: string;
  hermesHome: string | null;
  binaryPath: string | null;
  port: number | null;
  identityFile: string | null;
  proxyJump: string | null;
  runAs: string | null;
  container: { runtime: 'docker' | 'podman'; name: string } | null;
  command: string | null;
  /** Profile on the remote host. */
  profile: string;
  createdAt: string;
};

export type Project = {
  id: string;
  name: string;
  /** Local folder the project is scoped to. Null for chat-only projects
   * (Cowork tasks require a folder; plain Chat does not). For a remote
   * project this is a path on the *remote* host. */
  folderPath: string | null;
  profile: string;
  /** Set when this project's agent runs on another machine over SSH. */
  remote?: RemoteOrigin | null;
  createdAt: string;
  lastOpenedAt: string;
  archived: boolean;
};
export type ProjectSnapshot = { projects: Project[]; activeId: string | null };

/**
 * A persisted Chat conversation. Like CoworkTask, this is only the metadata
 * around one ACP session — the conversation itself lives in Hermes and is
 * replayed on resume via session/load. Unlike a task, a chat has no folder.
 */
export type ChatSession = {
  id: string;
  acpSessionId: string;
  title: string | null;
  projectId: string | null;
  /** Hermes profile the chat was created under — a session only exists in
   * that profile's HERMES_HOME, so resume must use it. Null on legacy rows. */
  profile: string | null;
  /** Set when the chat runs on a remote agent; resume reconnects to it. */
  remoteId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskStatus =
  | 'planning'          // kickoff sent, agent drafting the plan
  | 'awaiting_approval' // plan proposed, waiting for the user
  | 'executing'         // plan approved, agent working
  | 'done'              // agent finished after approval
  | 'failed'            // ACP/session error
  | 'stopped'           // user hit Stop
  | 'interrupted';      // app exited while the task was live

export type CoworkTask = {
  id: string;
  goal: string;
  cwd: string;
  profile: string;
  acpSessionId: string;
  projectId: string | null;
  /** Set when this task is a worker under a coordinator task. */
  parentTaskId: string | null;
  /** Denormalized from the project at creation: where the agent actually
   * runs. Null = local. Kept on the task so resume survives project edits. */
  remote?: RemoteOrigin | null;
  status: TaskStatus;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DirEntry = { name: string; kind: 'dir' | 'file'; size: number };
export type DirListing = { path: string; entries: DirEntry[] };

export type FilePreview =
  | { kind: 'text'; name: string; text: string; truncated: boolean }
  | { kind: 'image'; name: string; dataUri: string }
  | { kind: 'pdf'; name: string; dataUri: string }
  | { kind: 'unsupported'; name: string; size: number };

/**
 * What a task/worker may do inside its approved root. See
 * docs/security-model.md. Default-deny: read-only until the user widens it.
 */
export type PermissionPolicy = {
  /** Absolute path the task is scoped to; all file access is relative to this. */
  root: string;
  read: boolean;
  write: boolean;
  /** Deleting always prompts for approval regardless of approval mode. */
  delete: boolean;
  terminal: boolean;
  network: boolean;
};

export function defaultPolicy(root: string): PermissionPolicy {
  return { root, read: true, write: false, delete: false, terminal: false, network: false };
}

// ACP session model state (from session/new `models`, ACP protocol v1).
export type AcpModelInfo = { modelId: string; name: string; description?: string };
export type AcpModels = { currentModelId: string | null; availableModels: AcpModelInfo[] };

export type AcpClientMessage =
  | { kind: 'prompt'; sessionId: string; text: string }
  | { kind: 'approve'; sessionId: string; toolCallId: string; allow: boolean };

export type AcpServerMessage =
  // `role` defaults to 'agent'; 'user' appears when Hermes replays history
  // during session/load. `thought` marks reasoning text (ACP agent_thought_chunk)
  // as opposed to the reply itself.
  | { kind: 'token'; sessionId: string; text: string; role?: 'user' | 'agent'; thought?: boolean }
  // `op` is ACP's tool-call `kind`: read | edit | delete | move | search |
  // execute | think | fetch | other. `name` is the human title. `paths` are
  // the files the tool touches (from ACP `locations`).
  | { kind: 'tool-call'; sessionId: string; toolCallId: string; name: string; op: string; paths: string[]; args: unknown }
  | { kind: 'tool-result'; sessionId: string; toolCallId: string; result: unknown }
  // ACP `plan` update: the agent's current step list. Emitted as a live
  // checklist during execution and re-emitted whole when the agent re-plans.
  | { kind: 'plan'; sessionId: string; entries: Array<{ content: string; status: string }> }
  | { kind: 'approval-request'; sessionId: string; toolCallId: string; description: string }
  | { kind: 'approval-expired'; sessionId: string; toolCallId: string; description: string }
  | { kind: 'session-error'; sessionId: string; message: string; fatal: boolean }
  | { kind: 'done'; sessionId: string };

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

declare global {
  interface Window {
    hermes: import('../preload').HermesApi;
  }
}
