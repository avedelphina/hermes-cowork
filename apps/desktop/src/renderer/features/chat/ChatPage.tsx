import { useEffect } from 'react';
import { SessionList } from './SessionList';
import { MessageStream } from './MessageStream';
import { Composer } from './Composer';
import { useChatStore } from './chat.store';

export function ChatPage() {
  const sessionId = useChatStore((s) => s.sessionId);
  const startSession = useChatStore((s) => s.startSession);
  const ingest = useChatStore((s) => s.ingest);

  useEffect(() => {
    const off = window.hermes.acp.onEvent((evt) => ingest(evt));
    return () => { off(); };
  }, [ingest]);

  // Start a session lazily on first send — mounting the page no longer creates
  // a throwaway Hermes session.
  const ensureSession = async () => {
    const current = useChatStore.getState().sessionId;
    if (current) return current;
    const { sessionId: id } = await window.hermes.acp.start({ profile: 'default', cwd: '/' });
    startSession(id);
    return id;
  };

  const pick = async (id: string) => {
    const current = useChatStore.getState().sessionId;
    if (current === id) return;
    if (current) void window.hermes.acp.stop(current);
    // Set the session and clear the pane *before* the load so the history
    // Hermes replays during session/load lands in a fresh transcript instead
    // of being wiped by a late startSession().
    startSession(id);
    try {
      await window.hermes.acp.load({ sessionId: id });
    } catch (err) {
      useChatStore.getState().ingest({
        kind: 'session-error',
        sessionId: id,
        message: `Could not open session: ${err instanceof Error ? err.message : String(err)}`,
        fatal: true,
      });
    }
  };

  return (
    <div className="flex h-full flex-1">
      <SessionList activeId={sessionId} onPick={(id) => void pick(id)} />
      <div className="flex flex-1 flex-col">
        <MessageStream />
        <Composer ensureSession={ensureSession} placeholder="Message Hermes… ⌘↵ to send" />
      </div>
    </div>
  );
}
