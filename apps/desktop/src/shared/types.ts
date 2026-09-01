// Dashboard-derived types (ProfileSummary, Status) live in the renderer's
// api/schemas.ts as Zod schemas — they are only consumed there.

export type Project = {
  id: string;
  name: string;
  folderPath: string;
  profile: string;
  createdAt: string;
  lastOpenedAt: string;
  archived: boolean;
};
export type ProjectSnapshot = { projects: Project[]; activeId: string | null };

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

export type AcpClientMessage =
  | { kind: 'prompt'; sessionId: string; text: string }
  | { kind: 'approve'; sessionId: string; toolCallId: string; allow: boolean };

export type AcpServerMessage =
  // `role` defaults to 'agent'; 'user' appears when Hermes replays history
  // during session/load.
  | { kind: 'token'; sessionId: string; text: string; role?: 'user' | 'agent' }
  // `op` is ACP's tool-call `kind`: read | edit | delete | move | search |
  // execute | think | fetch | other. `name` is the human title. `paths` are
  // the files the tool touches (from ACP `locations`).
  | { kind: 'tool-call'; sessionId: string; toolCallId: string; name: string; op: string; paths: string[]; args: unknown }
  | { kind: 'tool-result'; sessionId: string; toolCallId: string; result: unknown }
  | { kind: 'approval-request'; sessionId: string; toolCallId: string; description: string }
  | { kind: 'session-error'; sessionId: string; message: string; fatal: boolean }
  | { kind: 'done'; sessionId: string };

declare global {
  interface Window {
    hermes: import('../preload').HermesApi;
  }
}
