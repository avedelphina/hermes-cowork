import { useEffect } from 'react';
import { GoalHeader } from './GoalHeader';
import { Transcript } from './Transcript';
import { Composer } from '../chat/Composer';
import { RightPane } from './RightPane';
import { useCoworkStore } from './cowork.store';
import { useWorkersStore } from './workers.store';

export function CoworkPage() {
  const ingestAcp = useCoworkStore((s) => s.ingestAcp);
  const sessionId = useCoworkStore((s) => s.sessionId);
  const taskId = useCoworkStore((s) => s.taskId);
  const pushUserText = useCoworkStore((s) => s.pushUserText);

  // Fresh worker list per coordinator task.
  useEffect(() => { useWorkersStore.getState().clear(); }, [taskId]);

  useEffect(() => {
    // Register the listener first, then either fire the kickoff (new task) or
    // replay a resumed task's history via session/load. Also feed the workers
    // store so worker sessions route to their own panes.
    const off = window.hermes.acp.onEvent((evt) => {
      ingestAcp(evt);
      useWorkersStore.getState().ingest(evt);
    });
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
