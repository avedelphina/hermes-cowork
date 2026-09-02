import { useEffect, useState } from 'react';
import { MessageStream } from './MessageStream';
import { Composer } from './Composer';
import { useChatStore } from './chat.store';
import { activeProject } from '../projects/project.store';
import { api } from '../../api/rest-client';

/** Shared conversation surface for Chat and Code modes (same chat.store). */
export function useChatSurface() {
  const startSession = useChatStore((s) => s.startSession);
  const ingest = useChatStore((s) => s.ingest);
  const [profile, setProfile] = useState('default');

  useEffect(() => {
    const off = window.hermes.acp.onEvent((evt) => ingest(evt));
    api.profiles()
      .then((ps) => setProfile(activeProject()?.profile ?? ps.find((p) => p.active)?.name ?? 'default'))
      .catch(() => { /* keep default */ });
    return () => { off(); };
  }, [ingest]);

  const ensureSession = async () => {
    const current = useChatStore.getState().sessionId;
    if (current) return current;
    const proj = activeProject();
    const { sessionId: id } = await window.hermes.acp.start({
      profile: proj?.profile ?? profile,
      ...(proj ? { cwd: proj.folderPath } : {}),
    });
    startSession(id);
    return id;
  };

  const pick = async (id: string) => {
    const current = useChatStore.getState().sessionId;
    if (current === id) return;
    if (current) void window.hermes.acp.stop(current);
    startSession(id);
    try {
      await window.hermes.acp.load({ sessionId: id, profile });
    } catch (err) {
      useChatStore.getState().ingest({
        kind: 'session-error',
        sessionId: id,
        message: `Could not open session: ${err instanceof Error ? err.message : String(err)}`,
        fatal: true,
      });
    }
  };

  return { profile, ensureSession, pick };
}

export function ChatSurface({ profile, ensureSession }: { profile: string; ensureSession: () => Promise<string | null> }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <MessageStream agentName={profile} />
      <Composer ensureSession={ensureSession} placeholder={`Message ${profile}… ⌘↵ to send`} />
    </div>
  );
}
