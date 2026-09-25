import { useEffect, useRef, useState } from 'react';
import { MessageStream } from './MessageStream';
import { Composer } from './Composer';
import { useChatStore } from './chat.store';
import { useChatsStore } from './chats.store';
import { activeProject, useProjectStore } from '../projects/project.store';
import { useRemotesStore } from '../remotes/remotes.store';
import { api } from '../../api/rest-client';

/** Conversation surface for Chat mode. */
export function useChatSurface() {
  const startSession = useChatStore((s) => s.startSession);
  const setChatId = useChatStore((s) => s.setChatId);
  const ingest = useChatStore((s) => s.ingest);
  const [profile, setProfile] = useState('default');
  // The remote agent new chats talk to; null = this computer.
  const [remoteId, setRemoteId] = useState<string | null>(null);
  // Resolves once the active profile is known, so a message sent right after
  // mount does not start the chat under 'default' by accident.
  const profileReady = useRef<Promise<string>>(Promise.resolve('default'));

  useEffect(() => {
    const off = window.hermes.acp.onEvent((evt) => ingest(evt));
    profileReady.current = api.profiles()
      .then((ps) => activeProject()?.profile ?? ps.find((p) => p.active)?.name ?? 'default')
      .catch(() => 'default');
    void profileReady.current.then(setProfile);
    void useChatsStore.getState().reload();
    void useRemotesStore.getState().reload();
    return () => { off(); };
  }, [ingest]);

  // Start a fresh ACP session and persist a chat row for it.
  const ensureSession = async () => {
    const current = useChatStore.getState().sessionId;
    if (current) return current;
    // A remote agent is its own thing — no local project, folder or profile.
    const agent = remoteId ? useRemotesStore.getState().remotes.find((r) => r.id === remoteId) ?? null : null;
    if (remoteId && !agent) throw new Error('That remote agent no longer exists.');
    const proj = agent ? null : activeProject();
    const chatProfile = agent?.profile ?? proj?.profile ?? (await profileReady.current);
    const { sessionId: id } = await window.hermes.acp.start({
      profile: chatProfile,
      ...(agent ? { remoteId: agent.id } : {}),
      ...(proj?.folderPath ? { cwd: proj.folderPath } : {}),
    });
    startSession(id);
    try {
      const chat = await window.hermes.chats.create({
        acpSessionId: id,
        projectId: proj?.id ?? null,
        title: null,
        profile: chatProfile,
        remoteId: agent?.id ?? null,
      });
      setChatId(chat.id);
      void useChatsStore.getState().reload();
    } catch {
      /* the ACP session still works; it just won't persist */
    }
    return id;
  };

  // Resume a persisted chat by its row id (replays history via session/load).
  const pick = async (chatId: string) => {
    if (useChatStore.getState().chatId === chatId) return;
    const chat = useChatsStore.getState().chats.find((c) => c.id === chatId);
    if (!chat) return;
    const current = useChatStore.getState().sessionId;
    if (current) void window.hermes.acp.stop(current);
    startSession(chat.acpSessionId);
    setChatId(chat.id);
    // Show which agent this chat belongs to (and keep it for the next new chat).
    setRemoteId(chat.remoteId);
    const proj = chat.projectId && !chat.remoteId
      ? useProjectStore.getState().projects.find((p) => p.id === chat.projectId)
      : null;
    try {
      await window.hermes.acp.load({
        sessionId: chat.acpSessionId,
        // Main reconnects to the chat's remote agent, if it has one.
        chatId: chat.id,
        // The profile it was created under — a different one is a different
        // HERMES_HOME with no such session.
        profile: chat.profile ?? proj?.profile ?? (await profileReady.current),
        ...(proj?.folderPath ? { cwd: proj.folderPath } : {}),
      });
    } catch (err) {
      useChatStore.getState().ingest({
        kind: 'session-error',
        sessionId: chat.acpSessionId,
        message: `Could not open chat: ${err instanceof Error ? err.message : String(err)}`,
        fatal: true,
      });
    }
  };

  return { profile, remoteId, setRemoteId, ensureSession, pick };
}

export function ChatSurface({ profile, ensureSession }: { profile: string; ensureSession: () => Promise<string | null> }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <MessageStream agentName={profile} />
      <Composer ensureSession={ensureSession} placeholder={`Message ${profile}… ⌘↵ to send`} />
    </div>
  );
}
