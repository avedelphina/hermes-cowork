import { useCoworkStore } from './cowork.store';
import { ApprovalCard } from './ApprovalCard';
import { Markdown } from '../../components/Markdown';

export function Transcript() {
  const { transcript, approvals } = useCoworkStore();

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 text-sm">
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
    </div>
  );
}
