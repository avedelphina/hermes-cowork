// apps/desktop/src/main/orchestrator/jsonrpc.ts
//
// Newline-delimited JSON (NDJSON) framing for ACP stdio. Each message is one
// line of JSON terminated by '\n'. ACP's reference Python client reads with
// readline(); see acp/connection.py.

export type JsonRpcMessage = Record<string, unknown>;

export function encodeFrame(msg: JsonRpcMessage): Buffer {
  return Buffer.from(JSON.stringify(msg) + '\n', 'utf8');
}

export class FrameDecoder {
  private buf = '';
  private consumedBytes: number;

  constructor(initialOffset = 0) {
    this.consumedBytes = initialOffset;
  }

  push(chunk: Buffer): JsonRpcMessage[] {
    return this.pushWithOffsets(chunk).messages;
  }

  /** Decode frames and report the absolute UTF-8 byte boundary after each complete line. */
  pushWithOffsets(chunk: Buffer): { messages: JsonRpcMessage[]; offsets: number[] } {
    this.buf += chunk.toString('utf8');
    const out: JsonRpcMessage[] = [];
    const offsets: number[] = [];

    let nl = this.buf.indexOf('\n');
    while (nl !== -1) {
      const rawLine = this.buf.slice(0, nl + 1);
      const line = rawLine.trim();
      this.buf = this.buf.slice(nl + 1);
      this.consumedBytes += Buffer.byteLength(rawLine, 'utf8');
      offsets.push(this.consumedBytes);
      if (line) {
        try {
          out.push(JSON.parse(line) as JsonRpcMessage);
        } catch {
          // Skip malformed lines, but retain their byte boundary for replay.
        }
      }
      nl = this.buf.indexOf('\n');
    }
    return { messages: out, offsets };
  }
}
