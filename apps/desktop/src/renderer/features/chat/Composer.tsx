import { useEffect, useState } from 'react';
import { useChatStore } from './chat.store';
import { ModelPicker } from '../../shell/ModelPicker';

type SendKey = 'mod-enter' | 'enter';
const SEND_KEY = 'hermes-send-key';

function loadSendKey(): SendKey {
  try {
    return localStorage.getItem(SEND_KEY) === 'enter' ? 'enter' : 'mod-enter';
  } catch {
    return 'mod-enter';
  }
}

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
  const [sendKey, setSendKey] = useState<SendKey>(loadSendKey);

  useEffect(() => {
    try {
      localStorage.setItem(SEND_KEY, sendKey);
    } catch {
      /* storage blocked — preference just won't persist */
    }
  }, [sendKey]);

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
  const hint = sendKey === 'enter' ? '↵ to send' : '⌘↵ to send';

  return (
    <div className="border-t border-border px-6 py-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setSendKey((k) => (k === 'enter' ? 'mod-enter' : 'enter'))}
          className="rounded-md bg-surface2 px-2 py-1 text-xs text-muted hover:text-fg"
          title="Key that sends a message (⌘↵ always works)"
          aria-label="Toggle send key"
        >
          Send: {sendKey === 'enter' ? '↵' : '⌘↵'}
        </button>
        {sessionId && <ModelPicker key={sessionId} sessionId={sessionId} />}
      </div>
      <textarea
        value={text}
        aria-label="Message input"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const mod = e.metaKey || e.ctrlKey;
          if (mod || (sendKey === 'enter' && !e.shiftKey)) { e.preventDefault(); void send(); }
        }}
        placeholder={placeholder ?? `Message Hermes... ${hint}`}
        rows={3}
        className="w-full resize-none rounded-lg border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
        disabled={busy || disabled || !canSend}
      />
    </div>
  );
}
