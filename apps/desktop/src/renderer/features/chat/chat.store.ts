// apps/desktop/src/renderer/features/chat/chat.store.ts
import { create } from 'zustand';
import type { AcpServerMessage } from '@shared/types';

type Message = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  toolCalls: Array<{ id: string; name: string; args: unknown; result?: unknown }>;
};

type ChatStore = {
  sessionId: string | null;
  /** Persisted ChatSession row id (from chats.json), or null before the first send. */
  chatId: string | null;
  messages: Message[];
  pendingApprovals: Array<{ toolCallId: string; description: string }>;
  startSession: (sessionId: string) => void;
  setChatId: (chatId: string | null) => void;
  ingest: (msg: AcpServerMessage) => void;
  reset: () => void;
};

export const useChatStore = create<ChatStore>((set) => ({
  sessionId: null,
  chatId: null,
  messages: [],
  pendingApprovals: [],

  startSession: (sessionId) =>
    set({ sessionId, messages: [], pendingApprovals: [] }),

  setChatId: (chatId) => set({ chatId }),

  reset: () => set({ sessionId: null, chatId: null, messages: [], pendingApprovals: [] }),

  ingest: (msg) =>
    set((s) => {
      // Ignore events for other ACP sessions (workers, other modes).
      if (s.sessionId && msg.sessionId !== s.sessionId) return s;
      switch (msg.kind) {
        case 'token': {
          const role = msg.role === 'user' ? 'user' : 'assistant';
          const last = s.messages[s.messages.length - 1];
          if (last && last.role === role) {
            return {
              messages: [
                ...s.messages.slice(0, -1),
                { ...last, text: last.text + msg.text },
              ],
            };
          }
          return {
            messages: [...s.messages, { role, text: msg.text, toolCalls: [] }],
          };
        }
        case 'tool-call': {
          let msgs = s.messages;
          let last = msgs[msgs.length - 1];
          if (!last || last.role !== 'assistant') {
            // Replay can deliver a tool call before any agent text — open a
            // shell assistant message to hang it on.
            msgs = [...msgs, { role: 'assistant', text: '', toolCalls: [] }];
            last = msgs[msgs.length - 1]!;
          }
          return {
            messages: [
              ...msgs.slice(0, -1),
              { ...last, toolCalls: [...last.toolCalls, { id: msg.toolCallId, name: msg.name, args: msg.args }] },
            ],
          };
        }
        case 'tool-result': {
          const last = s.messages[s.messages.length - 1];
          if (!last || last.role !== 'assistant') return s;
          return {
            messages: [
              ...s.messages.slice(0, -1),
              {
                ...last,
                toolCalls: last.toolCalls.map((t) =>
                  t.id === msg.toolCallId ? { ...t, result: msg.result } : t,
                ),
              },
            ],
          };
        }
        case 'approval-request':
          return {
            pendingApprovals: [
              ...s.pendingApprovals,
              { toolCallId: msg.toolCallId, description: msg.description },
            ],
          };
        case 'session-error':
          return {
            messages: [...s.messages, { role: 'system', text: `⚠️ ${msg.message}`, toolCalls: [] }],
          };
        case 'done':
          return s;
        default:
          // Unknown kind: never replace state with undefined — that nukes the
          // entire store because zustand's setState replaces (not merges) when
          // the next state is non-object. See acp-translator on the main side.
          return s;
      }
    }),
}));
