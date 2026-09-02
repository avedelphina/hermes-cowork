import { useState } from 'react';
import { useChatStore } from './chat.store';
import { ModelPicker } from '../../shell/ModelPicker';

type Props = {
  /** Active ACP session to send to. Omit to use the chat store's session. */
  sessionId?: string | null;
  /** Called when there is no session yet; must return one (or null to abort). */
  ensureSession?: () => Promise<string | null>;
  /** Echo the sent text somewhere. Omit to append to the chat store's messages. */
  onEcho?: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function Composer({ sessionId: sessionIdProp, ensureSession, onEcho, placeholder, disabled }: Props = {}) {
  const chatSessionId = useChatStore((s) => s.sessionId);
  const sessionId = sessionIdProp !== undefined ? sessionIdProp : chatSessionId;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!text.trim() || busy || disabled) return;
    setBusy(true);
    try {
      const sid = sessionId ?? (ensureSession ? await ensureSession() : null);
      if (!sid) return;
      if (onEcho) onEcho(text);
      else {
        useChatStore.setState((s) => ({
          messages: [...s.messages, { role: 'user', text, toolCalls: [] }],
        }));
      }
      await window.hermes.acp.send({ kind: 'prompt', sessionId: sid, text });
      setText('');
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!(sessionId || ensureSession);

  return (
    <div className="border-t border-border px-6 py-3">
      {sessionId && (
        <div className="mb-2 flex justify-end">
          <ModelPicker key={sessionId} sessionId={sessionId} />
        </div>
      )}
      <textarea
        value={text}
        aria-label="Message input"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
        }}
        placeholder={placeholder ?? 'Message Hermes... ⌘↵ to send'}
        rows={3}
        className="w-full resize-none rounded-lg border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
        disabled={busy || disabled || !canSend}
      />
    </div>
  );
}
