import { useEffect } from 'react';
import { GoalHeader } from './GoalHeader';
import { Transcript } from './Transcript';
import { Composer } from '../chat/Composer';
import { RightPane } from './RightPane';
import { useCoworkStore } from './cowork.store';

export function CoworkPage() {
  const ingestAcp = useCoworkStore((s) => s.ingestAcp);
  const sessionId = useCoworkStore((s) => s.sessionId);
  const pushUserText = useCoworkStore((s) => s.pushUserText);

  useEffect(() => {
    // Register the listener first, then either fire the kickoff (new task) or
    // replay a resumed task's history via session/load.
    const off = window.hermes.acp.onEvent((evt) => ingestAcp(evt));
    const s = useCoworkStore.getState();
    if (s.pendingKickoff && s.sessionId) {
      s.clearKickoff();
      void window.hermes.acp.send({ kind: 'prompt', sessionId: s.sessionId, text: s.pendingKickoff });
    } else if (s.taskId && s.sessionId && s.transcript.length === 0) {
      void window.hermes.acp.load({
        sessionId: s.sessionId, profile: s.profile, cwd: s.cwd, isolate: true,
      });
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
