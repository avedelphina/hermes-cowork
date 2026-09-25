// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import * as cp from 'node:child_process';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof cp>('node:child_process');
  return { ...actual, spawn: vi.fn() };
});

import { AcpSupervisor, stderrSummary, errorDetail, type AcpEvent } from '@main/orchestrator/acp-supervisor';
import { encodeFrame } from '@main/orchestrator/jsonrpc';

class MockProc extends EventEmitter {
  pid = 1234;
  written: Buffer[] = [];
  stdin = new Writable({
    write: (c: Buffer, _e, cb) => {
      this.written.push(Buffer.from(c));
      cb();
    },
  });
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
  kill(): void { this.emit('exit', 0); }

  /** Convenience: parse a single frame the supervisor wrote to stdin. */
  lastWrittenJson(): Record<string, unknown> {
    const last = this.written[this.written.length - 1];
    if (!last) throw new Error('nothing written');
    return JSON.parse(last.toString('utf8').trim());
  }
}

function makeSupervisor(remote?: { sshTarget: string }) {
  const proc = new MockProc();
  vi.mocked(cp.spawn).mockReturnValue(proc as unknown as cp.ChildProcess);
  const sup = new AcpSupervisor();
  const events: AcpEvent[] = [];
  sup.on('event', (e: AcpEvent) => events.push(e));
  sup.spawn({
    id: 's1', profile: 'default', cwd: '/tmp',
    binaryPath: '/usr/local/bin/hermes', hermesHome: '/Users/x/.hermes',
    ...(remote ? { remote } : {}),
  });
  return { sup, proc, events };
}

describe('AcpSupervisor', () => {
  beforeEach(() => vi.mocked(cp.spawn).mockReset());

  it('emits message events when child writes JSON-RPC frames', async () => {
    const { proc, events } = makeSupervisor();

    proc.stdout!.push(encodeFrame({ jsonrpc: '2.0', method: 'session/update', params: {} }));
    await new Promise((r) => setImmediate(r));

    expect(events).toEqual([
      { kind: 'message', sessionId: 's1', msg: { jsonrpc: '2.0', method: 'session/update', params: {} } },
    ]);
  });

  it('emits exit event when child exits', async () => {
    const { proc, events } = makeSupervisor();
    proc.emit('exit', 0);
    await new Promise((r) => setImmediate(r));
    expect(events).toContainEqual({ kind: 'exit', sessionId: 's1', code: 0, expected: false });
  });

  it('marks the exit as expected when we asked the child to shut down', async () => {
    const { sup, proc, events } = makeSupervisor();
    sup.shutdown('s1');
    proc.emit('exit', 0);
    await new Promise((r) => setImmediate(r));
    expect(events).toContainEqual({ kind: 'exit', sessionId: 's1', code: 0, expected: true });
  });

  it('request() resolves when matching response arrives, and does NOT broadcast it', async () => {
    const { sup, proc, events } = makeSupervisor();

    const promise = sup.request('s1', 'initialize', { protocolVersion: 1 });
    await new Promise((r) => setImmediate(r));

    const sent = proc.lastWrittenJson();
    expect(sent['method']).toBe('initialize');
    expect(typeof sent['id']).toBe('string');

    proc.stdout!.push(encodeFrame({ jsonrpc: '2.0', id: sent['id'] as string, result: { agentCapabilities: {} } }));
    await expect(promise).resolves.toEqual({ agentCapabilities: {} });

    // Response was filtered out; events list should not contain it.
    expect(events.find((e) => e.kind === 'message')).toBeUndefined();
  });

  it('request() rejects with a useful error on JSON-RPC error response', async () => {
    const { sup, proc } = makeSupervisor();
    const promise = sup.request('s1', 'session/prompt', { sessionId: 'x' });
    await new Promise((r) => setImmediate(r));
    const id = proc.lastWrittenJson()['id'] as string;
    proc.stdout!.push(encodeFrame({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params' } }));
    await expect(promise).rejects.toThrow(/Invalid params/);
  });

  it('request() includes Hermes\' error.data.details, where the real reason lives', async () => {
    const { sup, proc } = makeSupervisor();
    const promise = sup.request('s1', 'session/new', {});
    await new Promise((r) => setImmediate(r));
    const id = proc.lastWrittenJson()['id'] as string;
    proc.stdout!.push(encodeFrame({
      jsonrpc: '2.0', id,
      error: { code: -32603, message: 'Internal error', data: { details: 'No LLM provider configured. Run `hermes model`.' } },
    }));
    await expect(promise).rejects.toThrow('ACP error -32603: Internal error — No LLM provider configured. Run `hermes model`.');
  });

  it('rejects in-flight pending requests when the child exits', async () => {
    const { sup, proc } = makeSupervisor();
    const promise = sup.request('s1', 'initialize', {});
    proc.emit('exit', 1);
    await expect(promise).rejects.toThrow(/exited/);
  });

  describe('why a child died', () => {
    const tick = () => new Promise((r) => setImmediate(r));

    it('puts ssh stderr in the error for a remote child', async () => {
      const { sup, proc, events } = makeSupervisor({ sshTarget: 'box' });
      const pending = sup.request('s1', 'session/new', {}, 5000).catch((e: Error) => e);
      proc.stderr!.push('Warning: Permanently added host\nroot@box: Permission denied (publickey).\n');
      await tick();
      proc.emit('exit', 255);
      const err = (await pending) as Error;
      expect(err.message).toContain('code=255');
      expect(err.message).toContain('Permission denied (publickey)');
      expect(events).toContainEqual(expect.objectContaining({ kind: 'exit', code: 255, detail: expect.stringContaining('Permission denied') }));
    });

    it('keeps a local child\'s routine stderr out of the error', async () => {
      const { sup, proc, events } = makeSupervisor();
      const pending = sup.request('s1', 'session/new', {}, 5000).catch((e: Error) => e);
      proc.stderr!.push('WARNING Nous client unavailable\n');
      await tick();
      proc.emit('exit', 1);
      expect(((await pending) as Error).message).toBe('ACP child exited (code=1)');
      expect(events.find((e) => e.kind === 'exit')).not.toHaveProperty('detail');
    });

    it('does not blame stderr for a stop we asked for', async () => {
      const { sup, proc, events } = makeSupervisor({ sshTarget: 'box' });
      proc.stderr!.push('Killed by signal 15.\n');
      await tick();
      sup.shutdown('s1');
      proc.emit('exit', 0);
      await tick();
      expect(events.find((e) => e.kind === 'exit')).not.toHaveProperty('detail');
    });
  });
});

describe('stderrSummary', () => {
  it('keeps the last few non-empty lines and caps the length', () => {
    expect(stderrSummary('a\n\nb\nc\nd\n')).toBe('b / c / d');
    const long = stderrSummary('x'.repeat(1000));
    expect(long.length).toBeLessThanOrEqual(301);
    expect(long.startsWith('…')).toBe(true);
    expect(stderrSummary('')).toBe('');
  });
});

describe('errorDetail', () => {
  it('reads details from an object or a string, collapses whitespace, caps length, and is empty otherwise', () => {
    expect(errorDetail({ details: 'a\n  b' })).toBe(' — a b');
    expect(errorDetail('plain')).toBe(' — plain');
    expect(errorDetail('x'.repeat(500))).toHaveLength(3 + 400 + 1);
    for (const none of [undefined, null, {}, { details: 5 }, '  ']) expect(errorDetail(none)).toBe('');
  });
});
