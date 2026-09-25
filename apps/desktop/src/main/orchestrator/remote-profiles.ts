// apps/desktop/src/main/orchestrator/remote-profiles.ts
//
// Which Hermes profiles exist on a remote machine, so the UI can offer them
// instead of asking for a name to be typed. One short ssh command, no Hermes
// involved (Hermes is not started just to list directories).

import { execFile } from 'node:child_process';
import { isValidProfileName } from './hermes-home';
import { buildRemoteExec, remoteProfilesCommand } from './spawn-spec';
import { stderrSummary } from './acp-supervisor';
import type { RemoteOrigin } from '../../shared/types';

const MAX_PROFILES = 200;
const TIMEOUT_MS = 20_000;

/** Lines of script output → valid, de-duplicated profile names (`default` first). */
export function parseProfileList(stdout: string): string[] {
  const names = stdout.split('\n').map((l) => l.trim()).filter((n) => n === 'default' || isValidProfileName(n));
  const unique = [...new Set(names)].slice(0, MAX_PROFILES);
  return unique.sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)));
}

export function listRemoteProfiles(remote: RemoteOrigin): Promise<string[]> {
  const { command, args, env } = buildRemoteExec(remote, remoteProfilesCommand(remote));
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const why = stderrSummary(String(stderr)) || err.message;
        reject(new Error(`Could not reach ${remote.sshTarget}: ${why}`));
        return;
      }
      resolve(parseProfileList(String(stdout)));
    });
  });
}
