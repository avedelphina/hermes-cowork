// apps/desktop/src/main/orchestrator/spawn-spec.ts
//
// Maps ACP spawn options to a concrete child-process invocation. Two shapes:
//
//   local:  <binaryPath> acp                      (HERMES_HOME in env, cwd set)
//   remote: ssh -T -o BatchMode=yes <target> 'HERMES_HOME=<home> exec <bin> acp'
//
// Remote details (docs/remote-connection.md):
//  - `-T` disables the pseudo-terminal so the length-framed JSON-RPC stream
//    survives the pipe unmangled.
//  - `BatchMode=yes` fails fast on missing keys instead of hanging forever on
//    an interactive password prompt.
//  - `exec` replaces the remote shell with hermes, so killing the local ssh
//    process (stopSession / app quit) drops the connection and the remote
//    agent exits on stdin EOF — no orphaned remote Hermes.

import { isValidProfileName } from './hermes-home';
import type { RemoteOrigin } from '../../shared/types';

export type SpawnSpecInput = {
  profile: string;
  cwd: string;
  binaryPath: string;
  hermesHome: string;
  remote?: RemoteOrigin | null;
};

export type SpawnSpec = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** Local working directory for the child. Undefined for remote spawns —
   * the task cwd is a path on the *remote* host and is carried to the agent
   * via session/new, not via the local ssh process. */
  cwd?: string | undefined;
};

/**
 * SSH destination sanity check. Deliberately strict: letters, digits, and
 * `.`, `_`, `-`, `@` only — enough for [user@]host and ssh-config aliases.
 * No whitespace, no leading dash (option injection), no shell metacharacters
 * (the value is passed as its own argv element, but a `;` in a "hostname" is
 * never legitimate).
 */
export function isValidSshTarget(target: string): boolean {
  return (
    target.length > 0 &&
    target.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(target) &&
    // At most one '@' (user@host), and it cannot be first or last.
    (target.split('@').length - 1 <= 1) &&
    !target.startsWith('@') &&
    !target.endsWith('@')
  );
}

/** POSIX single-quote escaping for a fragment of the remote command line. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Shell fragment for the remote profile home. Mirrors the local convention
 * (hermes-home.ts): the `default` profile IS the global home, every other
 * profile lives at <global>/profiles/<name>.
 *
 * With no explicit hermesHome the fragment uses an *unquoted* `$HOME` so the
 * remote shell expands it; the profile suffix is shell-safe by construction
 * (isValidProfileName). An explicit hermesHome may contain spaces, so it is
 * single-quote escaped instead.
 */
function remoteHomeFragment(remote: RemoteOrigin, profile: string): string {
  if (!isValidProfileName(profile) && profile !== 'default') {
    throw new Error(`invalid profile name: ${JSON.stringify(profile)}`);
  }
  const suffix = profile === 'default' ? '' : `/profiles/${profile}`;
  const base = remote.hermesHome?.trim();
  return base ? `${shQuote(base)}${suffix}` : `$HOME/.hermes${suffix}`;
}

/** Shell fragment for the remote hermes binary. */
function remoteBinaryFragment(remote: RemoteOrigin): string {
  const bin = remote.binaryPath?.trim();
  // Default: resolved from the remote PATH. Note ssh runs a non-login shell —
  // if hermes lives outside the default PATH (e.g. ~/.local/bin), set an
  // explicit binaryPath on the project.
  return bin ? shQuote(bin) : 'hermes';
}

/** Build the concrete spawn invocation for a local or remote ACP child. */
export function buildSpawnSpec(opts: SpawnSpecInput): SpawnSpec {
  if (!opts.remote) {
    return {
      command: opts.binaryPath,
      args: ['acp'],
      env: { ...process.env, HERMES_HOME: opts.hermesHome },
      cwd: opts.cwd,
    };
  }
  const { sshTarget } = opts.remote;
  if (!isValidSshTarget(sshTarget)) {
    throw new Error(`invalid SSH target: ${JSON.stringify(sshTarget)}`);
  }
  const remoteCmd =
    `HERMES_HOME=${remoteHomeFragment(opts.remote, opts.profile)} ` +
    `exec ${remoteBinaryFragment(opts.remote)} acp`;
  // Scrub the local HERMES_HOME from the child's environment: the remote home
  // is set inside the remote command, and a leaked local value would be a
  // silent lie about which home is in play.
  const env = { ...process.env };
  delete env['HERMES_HOME'];
  return {
    command: 'ssh',
    args: ['-T', '-o', 'BatchMode=yes', sshTarget, remoteCmd],
    env,
    cwd: undefined,
  };
}
