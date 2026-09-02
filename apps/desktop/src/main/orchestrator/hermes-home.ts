// apps/desktop/src/main/orchestrator/hermes-home.ts
//
// Resolve the *global* Hermes home vs a *profile* home.
//
// Hermes keeps named profiles at `<global>/profiles/<name>`. The `default`
// profile is the global home itself. HERMES_HOME may point at either the
// global home or — as on Tom's machine — directly at a profile dir. If it
// already points at a profile, we must climb back to the global root instead
// of nesting another `profiles/<name>` under it (the bug that produced
// `.../profiles/anikke/profiles/anikke`).

import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';

export type HermesHomes = {
  /** Global Hermes home — the directory that contains `profiles/`. */
  global: string;
  /** Profile name HERMES_HOME was scoped to, or null if it is the global home. */
  envProfile: string | null;
};

export function resolveHermesHomes(
  env: string | undefined = process.env['HERMES_HOME'],
): HermesHomes {
  if (!env || !env.trim()) {
    return { global: join(homedir(), '.hermes'), envProfile: null };
  }
  const trimmed = env.replace(/[/\\]+$/, '');
  if (basename(dirname(trimmed)) === 'profiles') {
    return { global: dirname(dirname(trimmed)), envProfile: basename(trimmed) };
  }
  return { global: trimmed, envProfile: null };
}

/**
/** Hermes profile names are a single path segment: letters, digits, `.`, `_`, `-`. */
export function isValidProfileName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== '.' && name !== '..';
}

/**
 * Absolute home for a given profile. The `default` profile *is* the global
 * home; every other name lives at `<global>/profiles/<name>`. The name is
 * validated so a value like `../../x` cannot escape the profiles directory.
 */
export function profileHome(global: string, profile: string): string {
  if (!profile || profile === 'default') return global;
  if (!isValidProfileName(profile)) {
    throw new Error(`invalid profile name: ${JSON.stringify(profile)}`);
  }
  return join(global, 'profiles', profile);
}
