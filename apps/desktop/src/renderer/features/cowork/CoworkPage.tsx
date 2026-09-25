import { useEffect } from 'react';
import { GoalHeader } from './GoalHeader';
import { Transcript } from './Transcript';
import { Composer } from '../chat/Composer';
import { RightPane } from './RightPane';
import { useCoworkStore, syncAgentMode } from './cowork.store';

export function CoworkPage() {
  const ingestAcp = useCoworkStore((s) => s.ingestAcp);
  const sessionId = useCoworkStore((s) => s.sessionId);
  const pushUserText = useCoworkStore((s) => s.pushUserText);

  useEffect(() => {
    // Register the listener first, then either fire the kickoff (new task) or
    // replay a resumed task's history via session/load.
    const off = window.hermes.acp.onEvent(ingestAcp);
    const s = useCoworkStore.getState();
    if (s.pendingKickoff && s.sessionId) {
      s.clearKickoff();
      void window.hermes.acp.send({ kind: 'prompt', sessionId: s.sessionId, text: s.pendingKickoff });
    } else if (s.taskId && s.sessionId && s.transcript.length === 0) {
      const sessionId = s.sessionId;
      void window.hermes.acp.load({ sessionId, profile: s.profile, cwd: s.cwd, isolate: true, taskId: s.taskId })
        .then(() => syncAgentMode(useCoworkStore.getState()))
        .catch((e) => ingestAcp({ kind: 'session-error', sessionId, message: String(e), fatal: true }))
        .finally(() => useCoworkStore.getState().endReplay());
    }
    return () => { off(); };
  }, [ingestAcp]);

  return (
    <div className="flex h-full flex-1">
      <div className="flex flex-1 flex-col overflow-hidden">
        <GoalHeader />
        <Transcript />
        <Composer
          sessionId={sessionId}
          onEcho={pushUserText}
          placeholder="Steer the task — redirect, clarify, or add detail… ⌘↵"
        />
      </div>
      <RightPane />
    </div>
  );
}
