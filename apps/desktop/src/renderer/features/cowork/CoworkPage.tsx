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
    // Register the listener first, then fire any pending kickoff so none of the
    // streamed plan is lost in the gap between routes.
    const off = window.hermes.acp.onEvent((evt) => ingestAcp(evt));
    const { pendingKickoff, sessionId: sid, clearKickoff } = useCoworkStore.getState();
    if (pendingKickoff && sid) {
      clearKickoff();
      void window.hermes.acp.send({ kind: 'prompt', sessionId: sid, text: pendingKickoff });
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
