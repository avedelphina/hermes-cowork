import { useEffect, useRef, useState } from 'react';
import type { AcpPromptAttachment } from '@shared/types';
import { useChatStore } from './chat.store';
import { ModelPicker } from '../../shell/ModelPicker';

type SendKey = 'mod-enter' | 'enter';
const SEND_KEY = 'hermes-send-key';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const modifierLabel = isMac ? '⌥' : 'Ctrl+';

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
  ensureSession?: (text: string) => Promise<string | { sessionId: string; text: string } | null>;
  /** Echo the sent text somewhere. Omit to append to the chat store's messages. */
  onEcho?: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function Composer({ sessionId: sessionIdProp, ensureSession, onEcho, placeholder, disabled }: Props = {}) {
  const chatSessionId = useChatStore((s) => s.sessionId);
  const sessionId = sessionIdProp !== undefined ? sessionIdProp : chatSessionId;
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AcpPromptAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendKey, setSendKey] = useState<SendKey>(loadSendKey);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SEND_KEY, sendKey);
    } catch {
      /* storage blocked — preference just won't persist */
    }
  }, [sendKey]);

  const addFiles = async (files: FileList | File[]) => {
    const next: AcpPromptAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('text/')) {
        setError(`${file.name}: only images and text files can be attached`);
        continue;
      }
      if (file.size > 3_000_000) {
        setError(`${file.name}: attachment is larger than 3 MB`);
        continue;
      }
      const data = file.type.startsWith('image/')
        ? await file.arrayBuffer().then((buffer) => {
          let binary = '';
          for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
          return btoa(binary);
        })
        : await file.text();
      next.push({ name: file.name, mimeType: file.type || 'text/plain', data });
    }
    if (next.length) {
      setAttachments((current) => [...current, ...next].slice(0, 10));
      setError(null);
    }
  };

  const send = async () => {
    if ((!text.trim() && attachments.length === 0) || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = sessionId ?? (ensureSession ? await ensureSession(text) : null);
      const sid = typeof prepared === 'string' ? prepared : prepared?.sessionId ?? null;
      const wireText = typeof prepared === 'string' || !prepared ? text : prepared.text;
      if (!sid) return;
      if (onEcho) onEcho(text);
      else {
        useChatStore.setState((s) => ({
          messages: [...s.messages, { role: 'user', text, toolCalls: [] }],
        }));
      }
      await window.hermes.acp.send({ kind: 'prompt', sessionId: sid, text: wireText, attachments });
      setText('');
      setAttachments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!(sessionId || ensureSession);
  const hint = sendKey === 'enter' ? '↵ to send' : `${modifierLabel}↵ to send`;

  return (
    <div className="border-t border-border px-6 py-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setSendKey((k) => (k === 'enter' ? 'mod-enter' : 'enter'))}
          className="rounded-md bg-surface2 px-2 py-1 text-xs text-muted hover:text-fg"
          title={`Key that sends a message (${modifierLabel}↵ always works)`}
          aria-label="Toggle send key"
        >
          Send: {sendKey === 'enter' ? '↵' : `${modifierLabel}↵`}
        </button>
        {sessionId && <ModelPicker key={sessionId} sessionId={sessionId} />}
      </div>
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached files">
          {attachments.map((file, index) => (
            <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface2 px-2 py-1 text-xs text-muted">
              <span className="max-w-48 truncate">{file.name}</span>
              <button type="button" className="text-dim hover:text-danger" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}>×</button>
            </span>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mb-2 text-xs text-danger">{error}</p>}
      <textarea
        id="composer-input"
        value={text}
        aria-label="Message input"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) { e.preventDefault(); void addFiles(files); }
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const mod = isMac ? e.metaKey : e.ctrlKey;
          if (mod || (sendKey === 'enter' && !e.shiftKey)) { e.preventDefault(); void send(); }
        }}
        placeholder={placeholder ? `${placeholder} ${hint}` : `Message Hermes... ${hint}`}
        rows={3}
        className="w-full resize-none rounded-lg border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
        disabled={busy || disabled || !canSend}
      />
      <div className="mt-2 flex items-center justify-between text-xs text-dim">
        <div className="flex items-center gap-2">
          <button type="button" className="rounded-md bg-surface2 px-2 py-1 text-muted hover:text-fg" onClick={() => fileInputRef.current?.click()} disabled={busy || disabled}>Attach</button>
          <input ref={fileInputRef} type="file" multiple accept="image/*,text/*" className="hidden" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.currentTarget.value = ''; }} />
          <span>Paste files or images here</span>
        </div>
        <span>{hint}</span>
      </div>
    </div>
  );
}
