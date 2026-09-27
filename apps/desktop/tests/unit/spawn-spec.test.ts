// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildSpawnSpec, isValidSshTarget, isValidRemoteCwd, normalizeRemote, remoteProfilesCommand, shQuote } from '@main/orchestrator/spawn-spec';

const LOCAL = {
  profile: 'anikke',
  cwd: '/tmp/work',
  binaryPath: '/usr/local/bin/hermes',
  hermesHome: '/Users/x/.hermes/profiles/anikke',
};

describe('isValidSshTarget', () => {
  it('accepts hosts, aliases, and user@host', () => {
    for (const ok of ['helsinki', 'root@192.0.2.10', 'tom@box.example.com', 'gpu-box_1']) {
      expect(isValidSshTarget(ok), ok).toBe(true);
    }
  });

  it('rejects option injection, whitespace, and shell metacharacters', () => {
    for (const bad of [
      '', '-oProxyCommand=evil', '--', 'host; rm -rf /', 'host name', 'a"b', "a'b",
      'a$b', 'a`b`', 'a|b', '@host', 'user@', 'user@host@extra', 'host:22',
    ]) {
      expect(isValidSshTarget(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('shQuote', () => {
  it('wraps in single quotes and escapes embedded quotes', () => {
    expect(shQuote('/plain/path')).toBe("'/plain/path'");
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
    expect(shQuote('')).toBe("''");
  });
});

describe('buildSpawnSpec — local', () => {
  it('spawns the binary directly with HERMES_HOME and cwd', () => {
    const spec = buildSpawnSpec(LOCAL);
    expect(spec.command).toBe('/usr/local/bin/hermes');
    expect(spec.args).toEqual(['acp']);
    expect(spec.env['HERMES_HOME']).toBe('/Users/x/.hermes/profiles/anikke');
    expect(spec.cwd).toBe('/tmp/work');
  });
});

describe('buildSpawnSpec — remote', () => {
  const remote = { sshTarget: 'root@helsinki' };

  it('wraps the agent in ssh with BatchMode and no pty', () => {
    const spec = buildSpawnSpec({ ...LOCAL, remote });
    expect(spec.command).toBe('ssh');
    expect(spec.args.slice(0, 3)).toEqual(['-T', '-o', 'BatchMode=yes']);
    // A dead link or black-holed host must fail in seconds, not hang the task.
    expect(spec.args).toEqual(expect.arrayContaining(['ConnectTimeout=10', 'ServerAliveInterval=15', 'ServerAliveCountMax=3']));
    expect(spec.args.at(-2)).toBe('root@helsinki');
    // No local cwd: the task folder lives on the remote host.
    expect(spec.cwd).toBeUndefined();
    expect(spec.env['HERMES_HOME']).toBeUndefined();
  });

  // The remote command is `exec sh -c '<script>'` so the login shell does not matter.
  const wrap = (script: string) => `exec sh -c '${script.replace(/'/g, `'\\''`)}'`;
  const cmd = (r: Record<string, unknown>, profile = 'anikke') =>
    buildSpawnSpec({ ...LOCAL, profile, remote: { sshTarget: 'h', ...r } }).args.at(-1);

  it('defaults to $HOME/.hermes/profiles/<name> and PATH-resolved hermes, via sh -c', () => {
    expect(cmd({})).toBe(wrap('HERMES_HOME=$HOME/.hermes/profiles/anikke exec hermes acp'));
  });

  it('uses the global home for the default profile', () => {
    expect(cmd({}, 'default')).toBe(wrap('HERMES_HOME=$HOME/.hermes exec hermes acp'));
  });

  it('quotes explicit remote home and binary overrides', () => {
    expect(cmd({ hermesHome: '/opt/hermes home', binaryPath: '/usr/local/bin/hermes' })).toBe(
      wrap("HERMES_HOME='/opt/hermes home'/profiles/anikke exec '/usr/local/bin/hermes' acp"),
    );
  });

  describe('run as another user (sudo)', () => {
    it('runs the binary directly under sudo, so a sudoers rule for exactly `hermes acp` matches', () => {
      expect(cmd({ runAs: 'root' }, 'default')).toBe(wrap('exec sudo -n -u root -- hermes acp'));
    });

    it('carries an explicit home / profile through the environment', () => {
      expect(cmd({ runAs: 'root', hermesHome: '/root/.hermes' }, 'default'))
        .toBe(wrap("HERMES_HOME='/root/.hermes' exec sudo -n -u root -- hermes acp"));
      expect(cmd({ runAs: 'root', hermesHome: '/root/.hermes', binaryPath: '/usr/local/bin/hermes' }))
        .toBe(wrap("HERMES_HOME='/root/.hermes'/profiles/anikke exec sudo -n -u root -- '/usr/local/bin/hermes' acp"));
    });

    it('selects a non-default profile with Hermes\' --profile, so nothing has to survive sudo\'s env reset', () => {
      expect(cmd({ runAs: 'root', binaryPath: '/usr/local/bin/hermes' }, 'holly'))
        .toBe(wrap("exec sudo -n -u root -- '/usr/local/bin/hermes' --profile holly acp"));
      expect(cmd({ runAs: 'root' }, 'holly')).toBe(wrap('exec sudo -n -u root -- hermes --profile holly acp'));
    });

    it('rejects a hostile profile name under run-as too', () => {
      expect(() => cmd({ runAs: 'root' }, 'a;id')).toThrow(/invalid profile/);
    });
  });

  describe('Hermes in a container', () => {
    it('leaves the container\'s own HERMES_HOME alone for the default profile', () => {
      expect(cmd({ container: { runtime: 'docker', name: 'hermes-alison' } }, 'default'))
        .toBe(wrap("exec docker exec -i hermes-alison sh -c 'exec hermes acp'"));
    });

    it('derives a profile home from the container\'s environment, not the host\'s', () => {
      expect(cmd({ container: { runtime: 'podman', name: 'h1' } }))
        .toBe(wrap(`exec podman exec -i h1 sh -c 'HERMES_HOME=\${HERMES_HOME:-$HOME/.hermes}/profiles/anikke exec hermes acp'`));
    });

    it('honours an explicit home and binary inside the container, and can be combined with sudo', () => {
      expect(cmd({ container: { runtime: 'docker', name: 'c' }, hermesHome: '/data', binaryPath: '/opt/hermes/bin/hermes', runAs: 'root' }, 'default'))
        .toBe(wrap(`exec sudo -n -u root -- docker exec -i c sh -c 'HERMES_HOME='\\''/data'\\'' exec '\\''/opt/hermes/bin/hermes'\\'' acp'`));
    });
  });

  it('runs a custom command verbatim, not wrapped', () => {
    expect(cmd({ command: 'cd /srv/h && exec nix-shell --run "hermes acp"' })).toBe('cd /srv/h && exec nix-shell --run "hermes acp"');
  });

  it('adds port, key and jump host before the target, expanding ~ in the key path', () => {
    const args = buildSpawnSpec({
      ...LOCAL,
      remote: { sshTarget: 'h', port: 2222, identityFile: '~/.ssh/k', proxyJump: 'jump@b:22,c' },
    }).args;
    const target = args.indexOf('h');
    expect(args.slice(args.indexOf('-p'), target)).toEqual([
      '-p', '2222', '-i', join(homedir(), '.ssh/k'), '-o', 'IdentitiesOnly=yes', '-J', 'jump@b:22,c',
    ]);
  });

  it('rejects a hostile ssh target', () => {
    expect(() => buildSpawnSpec({ ...LOCAL, remote: { sshTarget: 'host;id' } })).toThrow(/invalid SSH target/);
    expect(() => buildSpawnSpec({ ...LOCAL, remote: { sshTarget: '-oProxyCommand=x' } })).toThrow(/invalid SSH target/);
  });

  it('rejects an unsafe profile name before it reaches the remote shell', () => {
    expect(() => buildSpawnSpec({ ...LOCAL, profile: 'a;id', remote })).toThrow(/invalid profile/);
    expect(() => buildSpawnSpec({ ...LOCAL, profile: '../x', remote })).toThrow(/invalid profile/);
  });
});

describe('isValidRemoteCwd', () => {
  it('accepts plain absolute paths', () => {
    expect(isValidRemoteCwd('/srv/work')).toBe(true);
    expect(isValidRemoteCwd('/home/me/my project')).toBe(true);
  });

  it('rejects ~, relative paths, .. segments and control characters', () => {
    for (const bad of ['~/work', 'work', '', '/srv/../etc', '/srv/work\n', '/srv/\0x']) {
      expect(isValidRemoteCwd(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isValidRemoteCwd('/srv/a..b')).toBe(true); // only a whole ".." segment is a traversal
  });
});

describe('normalizeRemote', () => {
  const ok = (extra: Record<string, unknown>) => normalizeRemote({ sshTarget: 'root@helsinki', ...extra }, true);
  const bad = (extra: Record<string, unknown>, allowCommand = true) =>
    expect(() => normalizeRemote({ sshTarget: 'root@helsinki', ...extra }, allowCommand));

  it('returns every optional field as null when unset, and accepts a numeric-string port', () => {
    expect(ok({})).toEqual({
      sshTarget: 'root@helsinki', hermesHome: null, binaryPath: null, port: null,
      identityFile: null, proxyJump: null, runAs: null, container: null, command: null,
    });
    expect(ok({ port: '2222' }).port).toBe(2222);
  });

  it('rejects bad ports, key paths, jump hosts, users, containers and runtimes', () => {
    for (const port of [0, 70000, 'x', 22.5]) bad({ port }).toThrow(/port/);
    for (const identityFile of ['id_rsa', '-oProxyCommand=x', '/k\nx']) bad({ identityFile }).toThrow(/key file/);
    for (const proxyJump of ['-oProxyCommand=x', 'a;b', 'a:99999', 'a,b,c,d,e', 'a:1:2']) bad({ proxyJump }).toThrow(/jump host/);
    for (const runAs of ['root;id', '-u', 'a b', '']) if (runAs) bad({ runAs }).toThrow(/run as/);
    for (const name of ['-x', 'a b', 'a;b', '']) bad({ container: { runtime: 'docker', name } }).toThrow(/container name/);
    bad({ container: { runtime: 'lxc', name: 'c' } }).toThrow(/runtime/);
  });

  it('allows a custom command only where asked, and not alongside the settings it replaces', () => {
    expect(ok({ command: 'exec hermes acp' }).command).toBe('exec hermes acp');
    bad({ command: 'exec hermes acp' }, false).toThrow(/only available on remote agents/);
    for (const other of [{ runAs: 'root' }, { hermesHome: '/x' }, { binaryPath: '/y' }, { container: { runtime: 'docker', name: 'c' } }]) {
      bad({ command: 'exec hermes acp', ...other }).toThrow(/replaces/);
    }
  });
});

describe('remoteProfilesCommand', () => {
  it('lists the container\'s own home, and refuses where it cannot see the remote user\'s home', () => {
    const c = remoteProfilesCommand({ sshTarget: 'h', container: { runtime: 'docker', name: 'hermes-alison' } });
    expect(c).toContain('docker exec hermes-alison sh -c');
    expect(c).toContain('HERMES_HOME:-$HOME/.hermes');
    expect(() => remoteProfilesCommand({ sshTarget: 'h', runAs: 'root' })).toThrow(/not available/);
    expect(() => remoteProfilesCommand({ sshTarget: 'h', command: 'x' })).toThrow(/not available/);
  });
});
