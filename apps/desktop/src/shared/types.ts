export type ProfileSummary = {
  name: string;
  active: boolean;
  hermesHome: string;
  model: string | null;
  provider: string | null;
};

export type StatusSnapshot = {
  hermesVersion: string;
  dashboardPort: number;
  gateway: { running: boolean; platforms: string[] };
};

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
  | { kind: 'tool-call'; sessionId: string; toolCallId: string; name: string; args: unknown }
  | { kind: 'tool-result'; sessionId: string; toolCallId: string; result: unknown }
  | { kind: 'approval-request'; sessionId: string; toolCallId: string; description: string }
  | { kind: 'session-error'; sessionId: string; message: string; fatal: boolean }
  | { kind: 'done'; sessionId: string };

declare global {
  interface Window {
    hermes: import('../preload').HermesApi;
  }
}
