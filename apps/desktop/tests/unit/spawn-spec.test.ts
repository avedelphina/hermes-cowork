// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildSpawnSpec, isValidSshTarget, shQuote } from '@main/orchestrator/spawn-spec';

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
    expect(spec.args[3]).toBe('root@helsinki');
    // No local cwd: the task folder lives on the remote host.
    expect(spec.cwd).toBeUndefined();
    expect(spec.env['HERMES_HOME']).toBeUndefined();
  });

  it('defaults to $HOME/.hermes/profiles/<name> and PATH-resolved hermes', () => {
    const spec = buildSpawnSpec({ ...LOCAL, remote });
    expect(spec.args[4]).toBe('HERMES_HOME=$HOME/.hermes/profiles/anikke exec hermes acp');
  });

  it('uses the global home for the default profile', () => {
    const spec = buildSpawnSpec({ ...LOCAL, profile: 'default', remote });
    expect(spec.args[4]).toBe('HERMES_HOME=$HOME/.hermes exec hermes acp');
  });

  it('quotes explicit remote home and binary overrides', () => {
    const spec = buildSpawnSpec({
      ...LOCAL,
      remote: { sshTarget: 'helsinki', hermesHome: '/opt/hermes home', binaryPath: '/usr/local/bin/hermes' },
    });
    expect(spec.args[4]).toBe(
      "HERMES_HOME='/opt/hermes home'/profiles/anikke exec '/usr/local/bin/hermes' acp",
    );
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
