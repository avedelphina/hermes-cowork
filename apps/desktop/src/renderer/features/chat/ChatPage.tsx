import { SessionList } from './SessionList';
import { useChatStore } from './chat.store';
import { ChatSurface, useChatSurface } from './ChatSurface';

export function ChatPage() {
  const sessionId = useChatStore((s) => s.sessionId);
  const { profile, ensureSession, pick } = useChatSurface();

  return (
    <div className="flex h-full flex-1">
      <SessionList activeId={sessionId} onPick={(id) => void pick(id)} />
      <ChatSurface profile={profile} ensureSession={ensureSession} />
    </div>
  );
}
