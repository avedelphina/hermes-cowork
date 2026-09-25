// @vitest-environment node
//
// Spike 0 of docs/cloud-hub.md: can an ACP run outlive its client? Drives
// apps/pipe/cowork-pipe.py with a scripted fake agent (always; needs python3)
// and, with HERMES_PIPE_TEST_REAL=1, with a real `hermes acp` (costs a couple
// of short model turns; HERMES_HOME picks the profile).
//
//   pnpm vitest run tests/integration/cowork-pipe.test.ts
//   HERMES_PIPE_TEST_REAL=1 pnpm vitest run tests/integration/cowork-pipe.test.ts
//
// What must hold:
//   1. killing the client (a hub crash) leaves the agent running
//   2. re-attaching at the processed offset continues the stream: nothing lost, nothing twice
//   3. an approval raised while nobody was attached can be answered after re-attaching
//   4. a frame a dead client only half sent never reaches the agent
//   5. stop ends the agent; a finished run replays its record and reports the exit code
//   6. a run whose daemon died exits 75 on attach and is never restarted
//   7. a newer attach takes over; the old client, and one whose stdin closes, exit 0

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type Frame = Record<string, unknown>;

const PIPE = resolve(__dirname, '../../../pipe/cowork-pipe.py');
const HAS_PYTHON = spawnSync('python3', ['--version']).status === 0;
const REAL = process.env['HERMES_PIPE_TEST_REAL'] === '1';

const FAKE_AGENT = `
import json, os, sys, time
def send(m):
    sys.stdout.write(json.dumps(m) + '\\n')
    sys.stdout.flush()
send({'jsonrpc': '2.0', 'method': 'hello', 'params': {'pid': os.getpid()}})
prompt = None
for line in iter(sys.stdin.readline, ''):
    try:
        m = json.loads(line)
    except ValueError:
        send({'jsonrpc': '2.0', 'method': 'parse_error', 'params': {'line': line}})
        continue
    if m.get('method') == 'session/prompt':
        prompt = m['id']
        for n in range(1, 41):
            send({'jsonrpc': '2.0', 'method': 'session/update', 'params': {'n': n}})
            time.sleep(0.02)
        send({'jsonrpc': '2.0', 'id': 'perm-1', 'method': 'session/request_permission', 'params': {}})
    elif m.get('id') == 'perm-1':
        send({'jsonrpc': '2.0', 'method': 'session/update', 'params': {'answer': m.get('result')}})
        send({'jsonrpc': '2.0', 'id': prompt, 'result': {'stopReason': 'end_turn'}})
    elif m.get('method') == 'ping':
        send({'jsonrpc': '2.0', 'id': m.get('id'), 'result': 'pong'})
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => T | undefined | false, ms = 10_000, what = 'condition'): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

function parseLines(text: string): Frame[] {
  return text.split('\n').filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l) as Frame; } catch { return { raw: l }; }
  });
}

const isAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/** One `cowork-pipe attach` client, reading the way a hub would. */
class PipeClient {
  readonly proc: ChildProcess;
  readonly frames: Frame[] = [];
  /** Bytes of complete lines processed: what a hub persists and re-attaches with. */
  offset: number;
  readonly exited: Promise<number | null>;
  private buf = Buffer.alloc(0);

  constructor(dir: string, runId: string, offset: number, argv: string[] = []) {
    this.offset = offset;
    this.proc = spawn('python3', [PIPE, 'attach', runId, String(offset), ...(argv.length ? ['--', ...argv] : [])], {
      env: { ...process.env, COWORK_PIPE_DIR: dir },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.exited = new Promise((res) => this.proc.on('exit', (code) => res(code)));
    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      for (let nl = this.buf.indexOf(0x0a); nl !== -1; nl = this.buf.indexOf(0x0a)) {
        this.frames.push(...parseLines(this.buf.subarray(0, nl).toString('utf8')));
        this.offset += nl + 1;
        this.buf = this.buf.subarray(nl + 1);
      }
    });
  }

  send(msg: Frame): void {
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  }

  find(pred: (f: Frame) => boolean): Frame | undefined {
    return this.frames.find(pred);
  }

  /** Stop reading and kill -9: a hub that died without a goodbye. Returns its offset. */
  crash(): number {
    this.proc.stdout!.removeAllListeners('data');
    this.proc.stdout!.destroy();
    this.proc.kill('SIGKILL');
    return this.offset;
  }
}

function suite(title: string, enabled: boolean, body: (ctx: { dir: () => string }) => void): void {
  (enabled ? describe : describe.skip)(title, () => {
    let dir = '';
    beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'cowork-pipe-')); });
    afterAll(() => {
      for (const run of existsSync(dir) ? readdirSync(dir) : []) stopRun(dir, run);
      rmSync(dir, { recursive: true, force: true });
    });
    body({ dir: () => dir });
  });
}

function stopRun(dir: string, runId: string): number | null {
  return spawnSync('python3', [PIPE, 'stop', runId], { env: { ...process.env, COWORK_PIPE_DIR: dir } }).status;
}

const record = (dir: string, runId: string, from = 0): Frame[] =>
  parseLines(readFileSync(join(dir, runId, 'frames')).subarray(from).toString('utf8'));

suite('cowork-pipe (scripted agent)', HAS_PYTHON, ({ dir }) => {
  let fake = '';
  beforeAll(() => {
    fake = join(dir(), 'fake-agent.py');
    writeFileSync(fake, FAKE_AGENT);
  });

  it('keeps the agent through a client crash and resumes at the processed offset', async () => {
    const a = new PipeClient(dir(), 'r1', 0, ['python3', fake]);
    const hello = await until(() => a.find((f) => f['method'] === 'hello'), 10_000, 'hello');
    const agentPid = (hello['params'] as { pid: number }).pid;
    a.send({ id: 'prompt-1', method: 'session/prompt', params: {} });
    await until(() => a.frames.filter((f) => f['method'] === 'session/update').length >= 10, 10_000, 'updates');

    const offset = a.crash();
    await sleep(200); // the agent keeps printing with nobody attached
    expect(isAlive(agentPid)).toBe(true);

    const b = new PipeClient(dir(), 'r1', offset);
    const perm = await until(() => b.find((f) => f['method'] === 'session/request_permission'), 10_000, 'approval');
    const seen = [...a.frames, ...b.frames];
    expect(record(dir(), 'r1').slice(0, seen.length)).toEqual(seen);
    const numbers = seen.flatMap((f) => (typeof (f['params'] as { n?: unknown })?.n === 'number' ? [(f['params'] as { n: number }).n] : []));
    expect(numbers).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));

    b.send({ id: perm['id'], result: { outcome: { outcome: 'selected', optionId: 'allow_once' } } });
    const done = await until(() => b.find((f) => f['id'] === 'prompt-1'), 10_000, 'turn end');
    expect(done['result']).toEqual({ stopReason: 'end_turn' });

    expect(stopRun(dir(), 'r1')).toBe(0);
    expect(await b.exited).toBe(0); // the agent's exit code (EOF on stdin → 0)
    expect(isAlive(agentPid)).toBe(false);

    const c = new PipeClient(dir(), 'r1', 0);
    expect(await c.exited).toBe(0);
    expect(c.frames).toEqual(record(dir(), 'r1'));
    expect(c.frames.filter((f) => f['method'] === 'hello')).toHaveLength(1);
  }, 30_000);

  it('never delivers a frame that a dead client only half sent', async () => {
    const a = new PipeClient(dir(), 'r2', 0, ['python3', fake]);
    await until(() => a.find((f) => f['method'] === 'hello'), 10_000, 'hello');
    a.proc.stdin!.write('{"jsonrpc":"2.0","id":"half","meth');
    await sleep(200); // let the daemon take the half frame
    const b = new PipeClient(dir(), 'r2', a.crash());
    b.send({ id: 'ping-1', method: 'ping' });
    const pong = await until(() => b.find((f) => f['id'] === 'ping-1'), 10_000, 'pong');
    expect(pong['result']).toBe('pong');
    expect([...a.frames, ...b.frames].some((f) => f['method'] === 'parse_error')).toBe(false);
    stopRun(dir(), 'r2');
    await b.exited;
  }, 30_000);

  it('reports a run whose daemon died as interrupted, and never restarts it', async () => {
    const a = new PipeClient(dir(), 'r3', 0, ['python3', fake]);
    const hello = await until(() => a.find((f) => f['method'] === 'hello'), 10_000, 'hello');
    // A host reboot takes the daemon and the agent together.
    process.kill(Number(readFileSync(join(dir(), 'r3', 'pid'), 'utf8')), 'SIGKILL');
    process.kill((hello['params'] as { pid: number }).pid, 'SIGKILL');
    expect(await a.exited).toBe(75);

    const b = new PipeClient(dir(), 'r3', 0, ['python3', fake]); // argv ignored: the run exists
    expect(await b.exited).toBe(75);
    expect(b.frames).toEqual(record(dir(), 'r3'));
    expect(b.frames.filter((f) => f['method'] === 'hello')).toHaveLength(1);
  }, 30_000);

  it('hands the agent to a newer attach, and detaches when stdin closes', async () => {
    const a = new PipeClient(dir(), 'r4', 0, ['python3', fake]);
    const hello = await until(() => a.find((f) => f['method'] === 'hello'), 10_000, 'hello');
    const b = new PipeClient(dir(), 'r4', a.offset);
    expect(await a.exited).toBe(0);
    b.send({ id: 'ping-2', method: 'ping' });
    await until(() => b.find((f) => f['id'] === 'ping-2'), 10_000, 'pong');
    b.proc.stdin!.end();
    expect(await b.exited).toBe(0);
    expect(isAlive((hello['params'] as { pid: number }).pid)).toBe(true);
    expect(stopRun(dir(), 'r4')).toBe(0);
    expect(isAlive((hello['params'] as { pid: number }).pid)).toBe(false);
  }, 30_000);

  it('stops the agent when its run dir is removed, so it cannot linger unreachable', async () => {
    const a = new PipeClient(dir(), 'r5', 0, ['python3', fake]);
    const hello = await until(() => a.find((f) => f['method'] === 'hello'), 10_000, 'hello');
    const agentPid = (hello['params'] as { pid: number }).pid;
    a.crash();
    rmSync(join(dir(), 'r5'), { recursive: true, force: true });
    await until(() => !isAlive(agentPid), 10_000, 'agent gone');
  }, 30_000);
});

suite('cowork-pipe with a real hermes acp', REAL && HAS_PYTHON, ({ dir }) => {
  it('keeps a real turn and an approval through client crashes', async () => {
    const work = join(dir(), 'work');
    mkdirSync(work, { recursive: true });
    const hermes = process.env['HERMES_PIPE_TEST_BIN'] ?? 'hermes';

    const a = new PipeClient(dir(), 'real', 0, [hermes, 'acp']);
    a.send({
      id: 'init', method: 'initialize', params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'cowork-pipe-spike', version: '0' },
      },
    });
    await until(() => a.find((f) => f['id'] === 'init'), 60_000, 'initialize');
    a.send({ id: 'new', method: 'session/new', params: { cwd: work, mcpServers: [] } });
    const created = await until(() => a.find((f) => f['id'] === 'new'), 60_000, 'session/new');
    const sessionId = (created['result'] as { sessionId: string }).sessionId;
    const prompt = (id: string, text: string) =>
      ({ id, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text }] } });

    // 1. A streaming turn: crash the client mid-stream, re-attach, the turn completes.
    a.send(prompt('turn-1', 'Count from 1 to 60, one number per line, and nothing else.'));
    await until(() => a.frames.filter((f) => f['method'] === 'session/update').length >= 5, 120_000, 'streaming');
    const offset1 = a.crash();
    await sleep(2_000);
    const b = new PipeClient(dir(), 'real', offset1);
    // Frames the first client processed before its crash count as seen: the turn may end there.
    const seen = () => [...a.frames, ...b.frames];
    const turn1 = await until(() => seen().find((f) => f['id'] === 'turn-1'), 180_000, 'turn-1 end');
    expect(record(dir(), 'real').slice(0, seen().length)).toEqual(seen());
    const streamed = seen().filter((f) => (f['params'] as { update?: { sessionUpdate?: string } })?.update?.sessionUpdate === 'agent_message_chunk');
    console.log(`[pipe-real] turn-1: ${JSON.stringify(turn1['result'] ?? turn1['error'])}; ${a.frames.length} frames before ` +
      `the crash, ${b.frames.length} after, ${streamed.length} text chunks; turn ended ${b.frames.includes(turn1) ? 'after' : 'before'} the crash`);
    expect(turn1['error']).toBeUndefined();

    // 2. An approval raised while nobody is attached, answered after re-attaching. A new ACP
    //    session is in Hermes' `default` mode ("Ask before edits"), so a file write always asks.
    b.send(prompt('turn-2', 'Create a file named approved.txt in the current folder containing the word yes.'));
    await sleep(500);
    const offset2 = b.crash();
    const later = () => [...b.frames, ...record(dir(), 'real', offset2)];
    const perm = await until(
      () => later().find((f) => f['method'] === 'session/request_permission' || f['id'] === 'turn-2'),
      120_000, 'approval or turn end');
    if (perm['id'] === 'turn-2') {
      console.warn('[pipe-real] turn-2 ended without asking for approval — approval path not exercised (profile approval mode?)');
    } else {
      const c = new PipeClient(dir(), 'real', offset2);
      const options = ((perm['params'] as { options?: Array<{ optionId: string; kind: string }> }).options) ?? [];
      const allow = options.find((o) => o.kind === 'allow_once');
      expect(allow).toBeTruthy();
      c.send({ id: perm['id'], result: { outcome: { outcome: 'selected', optionId: allow!.optionId } } });
      const turn2 = await until(() => c.find((f) => f['id'] === 'turn-2'), 180_000, 'turn-2 end');
      console.log(`[pipe-real] turn-2: ${JSON.stringify(turn2['result'] ?? turn2['error'])}; approved.txt written: ${existsSync(join(work, 'approved.txt'))}`);
      expect(existsSync(join(work, 'approved.txt'))).toBe(true);
      c.proc.stdin!.end();
      await c.exited;
    }
    expect(stopRun(dir(), 'real')).toBe(0);
  }, 600_000);
});
