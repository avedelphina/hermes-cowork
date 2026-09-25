import { useEffect } from 'react';
import { SessionList } from './SessionList';
import { useChatStore } from './chat.store';
import { useChatsStore } from './chats.store';
import { ChatSurface, useChatSurface } from './ChatSurface';
import { useRemotesStore } from '../remotes/remotes.store';

export function ChatPage() {
  const chatId = useChatStore((s) => s.chatId);
  const messages = useChatStore((s) => s.messages);
  const { profile, remoteId, setRemoteId, ensureSession, pick } = useChatSurface();
  const remotes = useRemotesStore((s) => s.remotes);
  const remote = remotes.find((r) => r.id === remoteId) ?? null;

  // Backfill a chat's title from its first non-empty user message.
  useEffect(() => {
    const id = useChatStore.getState().chatId;
    if (!id) return;
    const chat = useChatsStore.getState().chats.find((c) => c.id === id);
    if (chat?.title) return;
    const firstUser = messages.find((m) => m.role === 'user' && m.text.trim());
    if (!firstUser) return;
    void window.hermes.chats
      .update(id, { title: firstUser.text.trim().slice(0, 60) })
      .then(() => useChatsStore.getState().reload())
      .catch(() => { /* non-fatal */ });
  }, [messages]);

  return (
    <div className="flex h-full flex-1">
      <SessionList
        activeId={chatId}
        onPick={(id) => void pick(id)}
        onNew={() => useChatStore.getState().reset()}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        {remotes.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-[11px] text-muted">
            <span>Agent</span>
            <select
              value={remoteId ?? ''}
              onChange={(e) => setRemoteId(e.target.value || null)}
              disabled={!!chatId}
              aria-label="Agent"
              title={chatId ? 'This chat is bound to its agent — start a new chat to switch' : 'Who the next new chat talks to'}
              className="rounded border border-border bg-surface2 px-2 py-1 text-xs text-fg disabled:opacity-60"
            >
              <option value="">This computer ({profile})</option>
              {remotes.map((r) => (
                <option key={r.id} value={r.id}>⇄ {r.name} ({r.profile} @ {r.sshTarget})</option>
              ))}
            </select>
          </div>
        )}
        <ChatSurface profile={remote ? remote.name : profile} ensureSession={ensureSession} />
      </div>
    </div>
  );
}
