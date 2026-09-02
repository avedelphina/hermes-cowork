// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveHermesHomes, profileHome, isValidProfileName } from '@main/orchestrator/hermes-home';

describe('resolveHermesHomes', () => {
  it('defaults to ~/.hermes when HERMES_HOME is unset', () => {
    const r = resolveHermesHomes(undefined);
    expect(r.global.endsWith('/.hermes')).toBe(true);
    expect(r.envProfile).toBeNull();
  });

  it('treats a plain HERMES_HOME as the global home', () => {
    expect(resolveHermesHomes('/Users/x/.hermes')).toEqual({
      global: '/Users/x/.hermes',
      envProfile: null,
    });
  });

  it('climbs back to global when HERMES_HOME is a profile dir', () => {
    expect(resolveHermesHomes('/Users/x/.hermes/profiles/anikke')).toEqual({
      global: '/Users/x/.hermes',
      envProfile: 'anikke',
    });
  });

  it('ignores a trailing slash', () => {
    expect(resolveHermesHomes('/Users/x/.hermes/profiles/anikke/')).toEqual({
      global: '/Users/x/.hermes',
      envProfile: 'anikke',
    });
  });
});

describe('profileHome', () => {
  it('maps default to the global home itself', () => {
    expect(profileHome('/g/.hermes', 'default')).toBe('/g/.hermes');
  });

  it('maps a named profile under profiles/', () => {
    expect(profileHome('/g/.hermes', 'anikke')).toBe('/g/.hermes/profiles/anikke');
  });

  it('never double-nests a profile-scoped global home', () => {
    // global was already de-scoped by resolveHermesHomes, so this is safe.
    const { global } = resolveHermesHomes('/g/.hermes/profiles/anikke');
    expect(profileHome(global, 'anikke')).toBe('/g/.hermes/profiles/anikke');
  });

  it('rejects a traversal / separator in the profile name', () => {
    for (const bad of ['../../other', 'a/b', '..', '.', 'x/../y', '/etc']) {
      expect(() => profileHome('/g/.hermes', bad)).toThrow(/invalid profile/);
    }
  });
});

describe('isValidProfileName', () => {
  it('accepts plain names', () => {
    for (const ok of ['default', 'anikke', 'my-profile', 'p_1', 'A.b']) {
      expect(isValidProfileName(ok)).toBe(true);
    }
  });
  it('rejects traversal and separators', () => {
    for (const bad of ['..', '.', '../x', 'a/b', 'a\\b', '', '-lead', ' x']) {
      expect(isValidProfileName(bad)).toBe(false);
    }
  });
});
