// apps/desktop/src/main/orchestrator/spawn-spec.ts
//
// Maps ACP spawn options to a concrete child-process invocation. Two shapes:
//
//   local:  <binaryPath> acp                      (HERMES_HOME in env, cwd set)
//   remote: ssh -T -o BatchMode=yes … <target> "exec sh -c '<launch script>'"
//
// The launch script covers the ways Hermes is deployed (docs/remote-connection.md):
//   plain      HERMES_HOME=<home> exec <bin> acp
//   runAs      [HERMES_HOME=<home>] exec sudo -n -u <user> -- <bin> acp
//   container  exec [sudo …] <docker|podman> exec -i <name> sh -c '<script inside>'
//   command    the user's own command, verbatim (remote agents only, confirmed)
//
// Remote details (docs/remote-connection.md):
//  - `-T` disables the pseudo-terminal so the length-framed JSON-RPC stream
//    survives the pipe unmangled.
//  - `BatchMode=yes` fails fast on missing keys instead of hanging forever on
//    an interactive password prompt.
//  - `ConnectTimeout` / `ServerAlive*` bound a black-holed host and a dropped
//    connection (a dead link otherwise hangs the task for minutes, silently).
//  - The script is run through `sh -c`, so it behaves the same whatever the
//    remote login shell is (fish and tcsh do not speak `VAR=x cmd`).
//  - `exec` all the way down: killing the local ssh process (stopSession / app
//    quit) drops the connection and the remote agent exits on stdin EOF — no
//    orphaned remote Hermes.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { isValidProfileName } from './hermes-home';
import { CONTAINER_RUNTIMES, type RemoteOrigin } from '../../shared/types';

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

export const isValidPort = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 65535;

/** A local private-key path: absolute or `~/…`, no control characters, cannot be read as an option. */
export function isValidIdentityFile(p: string): boolean {
  return p.length <= 1024 && (p.startsWith('/') || p.startsWith('~/')) && !/[\0\r\n]/.test(p);
}

/** `-J` value: up to four comma-separated `[user@]host[:port]` hops, each shaped like an ssh target. */
export function isValidProxyJump(spec: string): boolean {
  const hops = spec.split(',');
  return hops.length <= 4 && hops.every((h) => {
    const [dest, port, ...rest] = h.split(':');
    return rest.length === 0 && isValidSshTarget(dest ?? '') && (port === undefined || (/^\d{1,5}$/.test(port) && isValidPort(Number(port))));
  });
}

/** A unix account name, as accepted by `sudo -u`. */
export const isValidRunAs = (u: string): boolean => /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/.test(u);

/** Docker/podman container name (or id): starts alphanumeric, then `[A-Za-z0-9_.-]`. */
export const isValidContainerName = (n: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(n);

/**
 * Validate and normalise a renderer-supplied remote origin. Every field is
 * checked here (the renderer is untrusted); optional ones come back as `null`.
 * `allowCommand` is false for projects — a free-form remote command exists
 * only on remote agents, where main also asks the user to confirm it.
 */
export function normalizeRemote(raw: unknown, allowCommand: boolean): RemoteOrigin {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('remote must be an object');
  const o = raw as Record<string, unknown>;
  const text = (k: string): string | null => {
    const v = o[k];
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string') throw new Error(`remote.${k} must be a string`);
    return v.trim() || null;
  };

  const sshTarget = typeof o['sshTarget'] === 'string' ? o['sshTarget'].trim() : '';
  if (!isValidSshTarget(sshTarget)) throw new Error(`invalid SSH target: ${JSON.stringify(o['sshTarget'])}`);

  const rawPort = o['port'];
  const port = rawPort === undefined || rawPort === null || rawPort === '' ? null : Number(rawPort);
  if (port !== null && !isValidPort(port)) throw new Error(`invalid SSH port: ${JSON.stringify(rawPort)}`);

  const identityFile = text('identityFile');
  if (identityFile !== null && !isValidIdentityFile(identityFile)) {
    throw new Error('SSH key file must be an absolute path (or start with ~/)');
  }
  const proxyJump = text('proxyJump');
  if (proxyJump !== null && !isValidProxyJump(proxyJump)) throw new Error(`invalid jump host: ${JSON.stringify(proxyJump)}`);
  const runAs = text('runAs');
  if (runAs !== null && !isValidRunAs(runAs)) throw new Error(`invalid "run as" user: ${JSON.stringify(runAs)}`);

  let container: RemoteOrigin['container'] = null;
  if (o['container'] !== undefined && o['container'] !== null) {
    const c = o['container'] as Record<string, unknown>;
    const runtime = c?.['runtime'];
    const name = typeof c?.['name'] === 'string' ? c['name'].trim() : '';
    if (!(CONTAINER_RUNTIMES as readonly unknown[]).includes(runtime)) throw new Error('container runtime must be docker or podman');
    if (!isValidContainerName(name)) throw new Error(`invalid container name: ${JSON.stringify(c?.['name'])}`);
    container = { runtime: runtime as 'docker' | 'podman', name };
  }

  const command = text('command');
  if (command !== null) {
    if (!allowCommand) throw new Error('a custom command is only available on remote agents');
    if (command.length > 2000 || /[\0]/.test(command)) throw new Error('custom command is too long or contains a NUL');
  }

  const hermesHome = text('hermesHome');
  const binaryPath = text('binaryPath');
  if (command !== null && (hermesHome || binaryPath || runAs || container)) {
    throw new Error('a custom command replaces the Hermes home, binary, "run as" and container settings — clear them or drop the command');
  }
  return { sshTarget, hermesHome, binaryPath, port, identityFile, proxyJump, runAs, container, command };
}

/** POSIX single-quote escaping for a fragment of the remote command line. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Shell fragment for the Hermes home a session should use. Mirrors the local
 * convention (hermes-home.ts): the `default` profile IS the global home, every
 * other profile lives at <global>/profiles/<name>.
 *
 * With no explicit hermesHome the base is expanded by the *remote* shell:
 * `$HOME/.hermes` on a host, or — inside a container, whose image usually sets
 * `HERMES_HOME` itself (`/opt/data` in the ones we have seen) —
 * `${HERMES_HOME:-$HOME/.hermes}`. The profile suffix is shell-safe by
 * construction (isValidProfileName); an explicit home may contain spaces, so it
 * is single-quote escaped.
 */
function remoteHomeFragment(remote: RemoteOrigin, profile: string, where: 'host' | 'container' = 'host'): string {
  if (!isValidProfileName(profile) && profile !== 'default') {
    throw new Error(`invalid profile name: ${JSON.stringify(profile)}`);
  }
  const suffix = profile === 'default' ? '' : `/profiles/${profile}`;
  const base = remote.hermesHome?.trim();
  if (base) return `${shQuote(base)}${suffix}`;
  return `${where === 'container' ? '${HERMES_HOME:-$HOME/.hermes}' : '$HOME/.hermes'}${suffix}`;
}

/** Shell fragment for the remote hermes binary. */
function remoteBinaryFragment(remote: RemoteOrigin): string {
  const bin = remote.binaryPath?.trim();
  // Default: resolved from the remote PATH. Note ssh runs a non-login shell —
  // if hermes lives outside the default PATH (e.g. ~/.local/bin), set an
  // explicit binaryPath on the project.
  return bin ? shQuote(bin) : 'hermes';
}

/** Run a POSIX script through `sh -c`, so the remote login shell (fish, tcsh…) does not matter. */
const viaSh = (script: string): string => `exec sh -c ${shQuote(script)}`;

/** The command line ssh runs on the remote to start `hermes acp` for a profile. */
export function buildRemoteCommand(remote: RemoteOrigin, profile: string): string {
  if (remote.command) return remote.command.trim(); // the user's own; verbatim, not wrapped
  const bin = remoteBinaryFragment(remote);
  const explicit = !!remote.hermesHome?.trim() || profile !== 'default';
  const sudo = remote.runAs ? `sudo -n -u ${remote.runAs} -- ` : '';

  if (remote.container) {
    const { runtime, name } = remote.container;
    const env = explicit ? `HERMES_HOME=${remoteHomeFragment(remote, profile, 'container')} ` : '';
    const inside = `${env}exec ${bin} acp`;
    return viaSh(`exec ${sudo}${runtime} exec -i ${name} sh -c ${shQuote(inside)}`);
  }
  if (remote.runAs) {
    if (!remote.hermesHome?.trim() && profile !== 'default') {
      // Hermes' own `--profile` resolves under the *target* user's Hermes home,
      // so nothing has to cross sudo's environment reset (`$HOME` here would be
      // the login user's, and HERMES_HOME would need `env_keep` on the host).
      // The sudoers rule can be exactly `<bin> --profile <name> acp`.
      if (!isValidProfileName(profile)) throw new Error(`invalid profile name: ${JSON.stringify(profile)}`);
      return viaSh(`exec ${sudo}${bin} --profile ${profile} acp`);
    }
    // Default profile: left to the target user's own environment. An explicit
    // home is carried in HERMES_HOME (which needs `env_keep` on the host).
    const env = explicit ? `HERMES_HOME=${remoteHomeFragment(remote, profile)} ` : '';
    return viaSh(`${env}exec ${sudo}${bin} acp`);
  }
  return viaSh(`HERMES_HOME=${remoteHomeFragment(remote, profile)} exec ${bin} acp`);
}

/**
 * The command that prints the profiles on a remote, one per line: `default`
 * when the Hermes home exists, then each directory under `<home>/profiles`.
 * Not available with a custom command or `runAs` (we cannot see another
 * user's home, or know what a custom command does) — type the name instead.
 */
export function remoteProfilesCommand(remote: RemoteOrigin): string {
  if (remote.command || remote.runAs) {
    throw new Error('Finding profiles is not available with a custom command or "run as" — type the profile name.');
  }
  const list = (home: string) =>
    `d=${home}; [ -d "$d" ] && echo default; for p in "$d"/profiles/*/; do [ -d "$p" ] && basename "$p"; done; true`;
  if (remote.container) {
    const { runtime, name } = remote.container;
    return viaSh(`${runtime} exec ${name} sh -c ${shQuote(list(remoteHomeFragment(remote, 'default', 'container')))}`);
  }
  return viaSh(list(remoteHomeFragment(remote, 'default')));
}

/** The ssh argv for a remote: fixed hardening flags, the user's connection options, target, command. */
function sshArgs(remote: RemoteOrigin, command: string): string[] {
  const identity = remote.identityFile?.startsWith('~/') ? join(homedir(), remote.identityFile.slice(2)) : remote.identityFile;
  return [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    ...(remote.port ? ['-p', String(remote.port)] : []),
    ...(identity ? ['-i', identity, '-o', 'IdentitiesOnly=yes'] : []),
    ...(remote.proxyJump ? ['-J', remote.proxyJump] : []),
    remote.sshTarget,
    command,
  ];
}

/** An ssh invocation of `command` on the remote, with the same flags and env hygiene as the ACP child. */
export function buildRemoteExec(remote: RemoteOrigin, command: string): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  // Re-validate: stored records and drafts are both untrusted by the time they reach ssh.
  normalizeRemote(remote, true);
  const env = { ...process.env };
  delete env['HERMES_HOME'];
  return { command: 'ssh', args: sshArgs(remote, command), env };
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
  // buildRemoteExec scrubs the local HERMES_HOME from the child's environment:
  // the remote home is set inside the remote command, and a leaked local value
  // would be a silent lie about which home is in play.
  return { ...buildRemoteExec(opts.remote, buildRemoteCommand(opts.remote, opts.profile)), cwd: undefined };
}
