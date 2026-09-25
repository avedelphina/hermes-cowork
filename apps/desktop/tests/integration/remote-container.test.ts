// @vitest-environment node
//
// Hermes inside a container on a remote host (docker/podman exec over SSH).
// Runs only when a target is given:
//
//   HERMES_REMOTE_TEST_CONTAINER='root@helsinki|docker|hermes-alison' \
//     pnpm vitest run tests/integration/remote-container.test.ts
//
// Asserts what the container deployment needs: the container's own
// HERMES_HOME is respected (no forced $HOME/.hermes), a session opens and
// lists models, profiles can be listed inside the container, and stopping
// leaves no `hermes acp` behind in it.

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { AcpSupervisor } from '@main/orchestrator/acp-supervisor';
import { AcpBridge } from '@main/orchestrator/acp-bridge';
import { listRemoteProfiles } from '@main/orchestrator/remote-profiles';
import type { RemoteOrigin } from '../../src/shared/types';

const spec = process.env['HERMES_REMOTE_TEST_CONTAINER'];
const [sshTarget, runtime, name] = (spec ?? '').split('|');
const describeContainer = spec && sshTarget && runtime && name ? describe : describe.skip;

const remote = (): RemoteOrigin => ({ sshTarget: sshTarget!, container: { runtime: runtime as 'docker' | 'podman', name: name! } });

function inContainer(script: string): string {
  return execFileSync('ssh', ['-T', '-o', 'BatchMode=yes', sshTarget!, `${runtime} exec ${name} sh -c '${script}'`], { encoding: 'utf8' });
}

describeContainer('remote ACP inside a container', () => {
  const bridge = new AcpBridge(new AcpSupervisor());
  afterAll(() => bridge.stopAll());

  it('opens a session using the container\'s own HERMES_HOME and lists models', async () => {
    const { sessionId } = await bridge.startSession({
      profile: 'default', cwd: '.', binaryPath: '/nonexistent', hermesHome: '/nonexistent', remote: remote(), isolate: true,
    });
    expect(sessionId).toBeTruthy();
    expect(bridge.getModels(sessionId)?.availableModels.length ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it('lists profiles inside the container', async () => {
    const profiles = await listRemoteProfiles(remote());
    console.log(`[container-profiles] ${JSON.stringify(profiles)}`);
    expect(profiles[0]).toBe('default');
  }, 60_000);

  it('leaves no hermes acp running in the container after stop', async () => {
    bridge.stopAll();
    await new Promise((r) => setTimeout(r, 7000));
    const out = inContainer(`pgrep -fa "[h]ermes acp" || true`);
    expect(out.trim()).toBe('');
  }, 30_000);
});
