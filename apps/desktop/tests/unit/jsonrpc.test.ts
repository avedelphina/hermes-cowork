// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { encodeFrame, FrameDecoder } from '@main/orchestrator/jsonrpc';

describe('encodeFrame', () => {
  it('produces newline-terminated JSON (NDJSON)', () => {
    const frame = encodeFrame({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(frame.toString('utf8')).toBe('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  });
});

describe('FrameDecoder', () => {
  it('decodes a single full line', () => {
    const dec = new FrameDecoder();
    expect(dec.push(Buffer.from('{"jsonrpc":"2.0","id":1,"result":"pong"}\n'))).toEqual([
      { jsonrpc: '2.0', id: 1, result: 'pong' },
    ]);
  });

  it('handles split lines across pushes', () => {
    const dec = new FrameDecoder();
    expect(dec.push(Buffer.from('{"jsonrpc":"2.0",'))).toEqual([]);
    expect(dec.push(Buffer.from('"id":1,"result":"pong"}\n'))).toEqual([
      { jsonrpc: '2.0', id: 1, result: 'pong' },
    ]);
  });

  it('decodes multiple lines in one push', () => {
    const dec = new FrameDecoder();
    expect(dec.push(Buffer.from('{"id":1}\n{"id":2}\n'))).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('skips blank lines and malformed lines without breaking the stream', () => {
    const dec = new FrameDecoder();
    expect(dec.push(Buffer.from('\nnot json\n{"id":3}\n'))).toEqual([{ id: 3 }]);
  });

  it('reports monotonic byte offsets for complete lines, including skipped lines', () => {
    const dec = new FrameDecoder();
    const first = dec.pushWithOffsets(Buffer.from('\nnot json\n{"id":3}\n', 'utf8'));
    expect(first.messages).toEqual([{ id: 3 }]);
    expect(first.offsets).toEqual([1, 10, 19]);
    expect(dec.pushWithOffsets(Buffer.from('{"id":4}', 'utf8'))).toEqual({ messages: [], offsets: [] });
    expect(dec.pushWithOffsets(Buffer.from('\n', 'utf8'))).toEqual({ messages: [{ id: 4 }], offsets: [28] });
  });

  it('buffers a partial trailing line until newline arrives', () => {
    const dec = new FrameDecoder();
    expect(dec.push(Buffer.from('{"id":4}'))).toEqual([]);
    expect(dec.push(Buffer.from('\n'))).toEqual([{ id: 4 }]);
  });
});
