// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseProfileList } from '@main/orchestrator/remote-profiles';
import { remoteProfilesScript, buildRemoteExec } from '@main/orchestrator/spawn-spec';

describe('parseProfileList', () => {
  it('puts default first, sorts the rest, drops junk and duplicates', () => {
    expect(parseProfileList('zed\nalice\ndefault\nalice\n\n../etc\nbad name\n$(x)\n')).toEqual(['default', 'alice', 'zed']);
  });

  it('is empty for no output', () => {
    expect(parseProfileList('')).toEqual([]);
  });
});

describe('remoteProfilesScript', () => {
  it('lists the default home and its profiles dir, expanding $HOME on the remote', () => {
    const s = remoteProfilesScript({ sshTarget: 'box' });
    expect(s).toContain('d=$HOME/.hermes;');
    expect(s).toContain('"$d"/profiles/*/');
  });

  it('quotes an explicit remote home', () => {
    expect(remoteProfilesScript({ sshTarget: 'box', hermesHome: "/srv/o'brien" })).toContain(`d='/srv/o'\\''brien';`);
  });
});

describe('buildRemoteExec', () => {
  it('reuses the ACP ssh flags and refuses a hostile target', () => {
    const spec = buildRemoteExec({ sshTarget: 'box' }, 'true');
    expect(spec.args).toEqual(expect.arrayContaining(['-T', 'BatchMode=yes', 'ConnectTimeout=10']));
    expect(spec.args.slice(-2)).toEqual(['box', 'true']);
    expect(spec.env['HERMES_HOME']).toBeUndefined();
    expect(() => buildRemoteExec({ sshTarget: '-oProxyCommand=x' }, 'true')).toThrow(/invalid SSH target/);
  });
});
