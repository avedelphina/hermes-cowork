import { useEffect } from 'react';
import { GoalHeader } from './GoalHeader';
import { Transcript } from './Transcript';
import { Composer } from '../chat/Composer';
import { RightPane } from './RightPane';
import { useCoworkStore, syncAgentMode } from './cowork.store';

const COWORK_SYSTEM_PROMPT = `You are running in Hermes Cowork mode. First propose a concise plan with todo_list and stop for approval. Do not edit files or run commands before approval. Keep the plan current as you work. For destructive operations, ask inline confirmation.`;

export function CoworkPage() {
  const ingestAcp = useCoworkStore((s) => s.ingestAcp);
  const sessionId = useCoworkStore((s) => s.sessionId);
  const title = useCoworkStore((s) => s.goal);
  const taskId = useCoworkStore((s) => s.taskId);
  const taskSessionId = useCoworkStore((s) => s.sessionId);
  const bindSession = useCoworkStore((s) => s.bindSession);
  const pushUserText = useCoworkStore((s) => s.pushUserText);
  const ensureFirstSession = async (text: string) => {
    if (taskSessionId) return taskSessionId;
    if (!taskId) return null;
    const task = await window.hermes.tasks.start(taskId);
    bindSession(task.acpSessionId!);
    return {
      sessionId: task.acpSessionId!,
      text: `${COWORK_SYSTEM_PROMPT}\n\nTask: ${title}\nWorking directory: ${useCoworkStore.getState().cwd}\n\nUser request: ${text}`,
    };
  };

  useEffect(() => {
    // Register the listener first, then either fire the kickoff (new task) or
    // replay a resumed task's history via session/load.
    const off = window.hermes.acp.onEvent(ingestAcp);
    const s = useCoworkStore.getState();
    if (s.sessionId) {
      void window.hermes.acp.drain(s.sessionId).then((events) => {
        for (const event of events) ingestAcp(event);
      });
    }
    if (s.pendingKickoff && s.sessionId) {
      s.clearKickoff();
      void window.hermes.acp.send({ kind: 'prompt', sessionId: s.sessionId, text: s.pendingKickoff });
    } else if (s.taskId && s.sessionId && s.transcript.length === 0) {
      const sessionId = s.sessionId;
      const restore = s.status === 'running'
        ? window.hermes.tasks.attach(s.taskId)
        : window.hermes.acp.load({ sessionId, profile: s.profile, cwd: s.cwd, isolate: true, taskId: s.taskId });
      void restore
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
          ensureSession={ensureFirstSession}
          onEcho={pushUserText}
          placeholder="Steer the task — redirect, clarify, or add detail… ⌘↵"
        />
      </div>
      <RightPane />
    </div>
  );
}
