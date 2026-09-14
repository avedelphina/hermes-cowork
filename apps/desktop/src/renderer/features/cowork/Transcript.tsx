import { useEffect, useRef } from 'react';
import { useCoworkStore } from './cowork.store';
import { useWorkersStore } from './workers.store';
import { ApprovalCard } from './ApprovalCard';
import { Markdown } from '../../components/Markdown';

const NEAR_BOTTOM_PX = 80;

function Dots() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
    </span>
  );
}

export function Transcript() {
  const { transcript, approvals, status } = useCoworkStore();
  const activeWorkers = useWorkersStore((s) => s.workers.filter((w) => w.status === 'running' || w.status === 'queued').length);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [transcript, approvals, status]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-6 py-4 text-sm">
      {transcript.length === 0 && (
        <div className="mt-12 text-center text-muted">Hermes will propose a plan shortly…</div>
      )}
      {transcript.map((m, i) => (
        <div key={i} className="mb-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
            {m.role === 'user' ? 'You' : m.role === 'system' ? 'System' : 'Hermes'}
          </div>
          {m.role === 'agent' ? (
            <Markdown text={m.text} className="text-fg" />
          ) : (
            <div
              className={
                'whitespace-pre-wrap' +
                (m.role === 'system'
                  ? ' text-danger'
                  : ' rounded-md border-l-2 border-accent bg-surface2 px-3 py-2 text-fg')
              }
            >
              {m.text}
            </div>
          )}
        </div>
      ))}
      {approvals.map((a) => (
        <ApprovalCard key={a.toolCallId} approval={a} />
      ))}
      {status === 'running' && approvals.length === 0 && (
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <Dots />
          {activeWorkers > 0 ? `Working — ${activeWorkers} subagent${activeWorkers > 1 ? 's' : ''} running…` : 'Working…'}
        </div>
      )}
      {status === 'idle' && approvals.length === 0 && transcript[transcript.length - 1]?.role === 'agent' && (
        <div className="rounded-md border-l-2 border-accent bg-surface2 px-3 py-2 text-[11px] text-accent">
          <div>⏸ Hermes stopped and is waiting on you — reply below to continue.</div>
          <div className="mt-1 text-dim">
            {activeWorkers > 0
              ? `${activeWorkers} background subagent${activeWorkers > 1 ? 's' : ''} still running.`
              : 'No background processes are running — if the message above claims otherwise, treat that as unverified.'}
          </div>
        </div>
      )}
    </div>
  );
}
