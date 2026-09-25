// apps/desktop/src/main/orchestrator/spawn-spec.ts
//
// Maps ACP spawn options to a concrete child-process invocation. Two shapes:
//
//   local:  <binaryPath> acp                      (HERMES_HOME in env, cwd set)
//   remote: ssh -T -o BatchMode=yes … <target> 'HERMES_HOME=<home> exec <bin> acp'
//
// Remote details (docs/remote-connection.md):
//  - `-T` disables the pseudo-terminal so the length-framed JSON-RPC stream
//    survives the pipe unmangled.
//  - `BatchMode=yes` fails fast on missing keys instead of hanging forever on
//    an interactive password prompt.
//  - `ConnectTimeout` / `ServerAlive*` bound a black-holed host and a dropped
//    connection (a dead link otherwise hangs the task for minutes, silently).
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

/**
 * A working folder on the remote host: an absolute path with no `..`. `~` is
 * not accepted — the path is handed to Hermes verbatim via session/new, and
 * nothing on that side expands it.
 */
export function isValidRemoteCwd(cwd: string): boolean {
  return cwd.startsWith('/') && !cwd.split('/').includes('..') && !/[\0\r\n]/.test(cwd);
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

/** ssh flags shared by every remote command we run. */
const SSH_OPTS = [
  '-T',
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10',
  '-o', 'ServerAliveInterval=15',
  '-o', 'ServerAliveCountMax=3',
];

/** An ssh invocation of `script` on the remote, with the same flags and env hygiene as the ACP child. */
export function buildRemoteExec(remote: RemoteOrigin, script: string): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (!isValidSshTarget(remote.sshTarget)) {
    throw new Error(`invalid SSH target: ${JSON.stringify(remote.sshTarget)}`);
  }
  const env = { ...process.env };
  delete env['HERMES_HOME'];
  return { command: 'ssh', args: [...SSH_OPTS, remote.sshTarget, script], env };
}

/**
 * Shell script that prints the profiles on a remote, one per line: `default`
 * when the Hermes home exists, then each directory under `<home>/profiles`.
 */
export function remoteProfilesScript(remote: RemoteOrigin): string {
  return (
    `d=${remoteHomeFragment(remote, 'default')}; ` +
    `[ -d "$d" ] && echo default; ` +
    `for p in "$d"/profiles/*/; do [ -d "$p" ] && basename "$p"; done; true`
  );
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
  const remoteCmd =
    `HERMES_HOME=${remoteHomeFragment(opts.remote, opts.profile)} ` +
    `exec ${remoteBinaryFragment(opts.remote)} acp`;
  // buildRemoteExec scrubs the local HERMES_HOME from the child's environment:
  // the remote home is set inside the remote command, and a leaked local value
  // would be a silent lie about which home is in play.
  return { ...buildRemoteExec(opts.remote, remoteCmd), cwd: undefined };
}
