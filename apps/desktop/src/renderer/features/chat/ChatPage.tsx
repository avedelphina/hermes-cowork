import { useEffect } from 'react';
import { SessionList } from './SessionList';
import { useChatStore } from './chat.store';
import { useChatsStore } from './chats.store';
import { ChatSurface, useChatSurface } from './ChatSurface';

export function ChatPage() {
  const chatId = useChatStore((s) => s.chatId);
  const messages = useChatStore((s) => s.messages);
  const { profile, ensureSession, pick } = useChatSurface();

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
      <ChatSurface profile={profile} ensureSession={ensureSession} />
    </div>
  );
}
