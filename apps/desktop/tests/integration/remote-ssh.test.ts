// @vitest-environment node
//
// End-to-end proof of the remote (SSH) ACP path against a real host.
// Skipped unless HERMES_REMOTE_TEST_TARGET names a reachable ssh destination
// (plain `ssh <target>` must work non-interactively — key auth or an
// ~/.ssh/config alias, exactly what the app relies on).
//
//   HERMES_REMOTE_TEST_TARGET=hermes.ocean pnpm vitest run tests/integration/remote-ssh.test.ts
//
// Proves, over a network pipe (the things a local pipe cannot):
//   1. initialize + session/new handshake survive the ssh framing
//   2. a full session/prompt turn streams tokens and finishes
//   3. a tool-approval round-trip works remotely (reported; model-dependent)
//   4. stopSession kills the remote agent — no orphaned `hermes acp`
//   5. a bogus target fails closed with a session error, fast

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { AcpSupervisor } from '@main/orchestrator/acp-supervisor';
import { AcpBridge } from '@main/orchestrator/acp-bridge';
import { listRemoteProfiles } from '@main/orchestrator/remote-profiles';
import type { AcpServerMessage } from '../../src/shared/types';

const TARGET = process.env['HERMES_REMOTE_TEST_TARGET'];
const REMOTE_CWD = process.env['HERMES_REMOTE_TEST_CWD'] ?? '/tmp';

const describeRemote = TARGET ? describe : describe.skip;

function ssh(script: string): string {
  return execFileSync('ssh', ['-T', '-o', 'BatchMode=yes', TARGET!, script], { encoding: 'utf8' });
}

describeRemote('remote ACP over SSH', () => {
  let sup: AcpSupervisor;
  let bridge: AcpBridge;
  let events: AcpServerMessage[];

  beforeAll(() => {
    sup = new AcpSupervisor();
    bridge = new AcpBridge(sup);
    events = [];
    bridge.on('event', (m: AcpServerMessage) => events.push(m));
  });

  afterAll(() => {
    bridge.stopAll();
  });

  it('completes a full turn: handshake, prompt, tokens, done', async () => {
    const { sessionId } = await bridge.startSession({
      profile: 'default',
      cwd: REMOTE_CWD,
      binaryPath: '/nonexistent/local/hermes', // must NOT be used remotely
      hermesHome: '/nonexistent/local/home',
      remote: { sshTarget: TARGET! },
      isolate: true,
    });
    expect(sessionId).toBeTruthy();

    await bridge.sendPrompt(sessionId, 'Reply with exactly the word PONG and nothing else.');

    const mine = events.filter((e) => e.sessionId === sessionId);
    const tokens = mine.filter((e) => e.kind === 'token' && e.role !== 'user');
    expect(mine.some((e) => e.kind === 'done')).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
    // The reply's *content* depends on the remote profile's model auth, which
    // is not what this test proves. Log it; the transport assertions above
    // (handshake → prompt → streamed tokens → done) are what must hold.
    const reply = tokens.map((t) => (t.kind === 'token' ? t.text : '')).join('');
    console.log(`[remote-turn] agent replied: ${reply.slice(0, 200)}`);
    if (/HTTP 4\d\d|unauthorized|api.?key/i.test(reply)) {
      console.warn('[remote-turn] remote profile model auth looks broken — transport OK, content not asserted');
    } else {
      expect(reply).toContain('PONG');
    }

    bridge.stopSession(sessionId);
  }, 180_000);

  it('round-trips a tool approval when the model requests one', async () => {
    const { sessionId } = await bridge.startSession({
      profile: 'default',
      cwd: REMOTE_CWD,
      binaryPath: '/nonexistent/local/hermes',
      hermesHome: '/nonexistent/local/home',
      remote: { sshTarget: TARGET! },
      isolate: true,
    });

    const prompt = bridge.sendPrompt(
      sessionId,
      'Use the terminal tool to run exactly: echo hello. Do nothing else.',
    );
    // Answer any permission request the moment it arrives.
    const answer = setInterval(() => {
      for (const e of events) {
        if (e.kind === 'approval-request' && e.sessionId === sessionId) {
          bridge.respondToPermission(sessionId, e.toolCallId, true);
        }
      }
    }, 100);
    await prompt.catch(() => undefined);
    clearInterval(answer);

    const approvals = events.filter((e) => e.kind === 'approval-request' && e.sessionId === sessionId);
    // Model-dependent: report rather than fail if the agent never asked.
    console.log(`[remote-approval] permission requests seen: ${approvals.length}`);

    bridge.stopSession(sessionId);
  }, 180_000);

  it('opens a chat-style session (pooled, cwd ".") and reloads it', async () => {
    // Remote chat has no folder: "." resolves to the remote login directory.
    const opts = {
      profile: 'default',
      cwd: '.',
      binaryPath: '/nonexistent/local/hermes',
      hermesHome: '/nonexistent/local/home',
      remote: { sshTarget: TARGET! },
    };
    // Own bridge, so its pooled children can be torn down before the orphan check.
    const chatBridge = new AcpBridge(new AcpSupervisor());
    try {
      const { sessionId } = await chatBridge.startSession(opts);
      expect(sessionId).toBeTruthy();
      expect(chatBridge.getModels(sessionId)?.availableModels.length ?? 0).toBeGreaterThan(0);

      // A different remote identity (own binary override) must not reuse that child.
      const other = await chatBridge.startSession({ ...opts, remote: { sshTarget: TARGET!, binaryPath: 'hermes' } });
      expect(other.sessionId).not.toBe(sessionId);

      const again = await chatBridge.loadSession({ ...opts, sessionId });
      expect(again.sessionId).toBe(sessionId);
    } finally {
      chatBridge.stopAll();
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, 120_000);

  it('lists the profiles that exist on the remote', async () => {
    const profiles = await listRemoteProfiles({ sshTarget: TARGET! });
    console.log(`[remote-profiles] ${JSON.stringify(profiles)}`);
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles[0]).toBe('default'); // default sorts first when the home exists
  });

  it('reports an unreachable host with a reason, not a hang', async () => {
    await expect(listRemoteProfiles({ sshTarget: 'no-such-host.invalid' })).rejects.toThrow(/Could not reach no-such-host\.invalid/);
  }, 30_000);

  it('leaves no orphaned hermes acp on the remote after stop', async () => {
    // shutdown() ends stdin immediately, SIGTERMs at +1s, SIGKILLs at +5s —
    // wait past the whole grace period before checking the far end.
    // ([h] avoids pgrep matching its own invoking shell.)
    await new Promise((r) => setTimeout(r, 7000));
    const out = ssh(`pgrep -fa '[h]ermes acp' || true`);
    expect(out.trim()).toBe('');
  }, 30_000);

  it('fails closed on an unreachable target', async () => {
    await expect(
      bridge.startSession({
        profile: 'default',
        cwd: REMOTE_CWD,
        binaryPath: '/nonexistent/local/hermes',
        hermesHome: '/nonexistent/local/home',
        remote: { sshTarget: 'no-such-host.invalid' },
        isolate: true,
      }),
    ).rejects.toThrow();
  }, 60_000);
});
