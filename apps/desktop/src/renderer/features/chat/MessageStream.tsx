import { useChatStore } from './chat.store';
import { ToolCallCard } from './ToolCallCard';
import { Markdown } from '../../components/Markdown';

export function MessageStream({ agentName = 'Hermes' }: { agentName?: string }) {
  const messages = useChatStore((s) => s.messages);
  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      {messages.length === 0 && (
        <div className="mt-12 text-center text-sm text-muted">
          Send a message to begin.
        </div>
      )}
      {messages.map((m, i) => (
        <div key={i} className="mb-6">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
            {m.role === 'user' ? 'You' : m.role === 'system' ? 'System' : agentName}
          </div>
          {m.role === 'user' || m.role === 'system' ? (
            <div
              className={
                'whitespace-pre-wrap text-sm ' +
                (m.role === 'system'
                  ? 'text-danger'
                  : 'rounded-md border-l-2 border-accent bg-surface2 px-3 py-2 text-fg')
              }
            >
              {m.text}
            </div>
          ) : (
            <Markdown text={m.text} className="text-sm text-fg" />
          )}
          {m.toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} name={tc.name} args={tc.args} result={tc.result} />
          ))}
        </div>
      ))}
    </div>
  );
}
