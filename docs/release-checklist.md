# Release checklist

## Pre-release

- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` clean (CI green).
- [ ] `pnpm -r build` clean.
- [ ] e2e against a real Hermes 0.20.6:
  - [ ] `pnpm --filter @hermes-cowork/desktop exec playwright test` — smoke,
        projects, cowork-flow, multi-agent all pass.
- [ ] Clean-machine check: fresh clone, `corepack enable`, `nvm use`,
      `pnpm install`, `pnpm --filter @hermes-cowork/desktop dev` launches with
      no manual steps (no `node_modules` surgery).
- [ ] Bump `version` in `package.json` and `apps/desktop/package.json`.
- [ ] Update `README.md` status line and `docs/acp-notes.md` if the tested
      Hermes version changed; bump `MIN_HERMES_VERSION` only against a version
      actually exercised.

## Package

- [ ] `pnpm --filter @hermes-cowork/desktop build:mac` produces
      `apps/desktop/release/Hermes Cowork-<version>-arm64.dmg`.
- [ ] Signing + notarisation (needs an Apple Developer cert on the build
      machine): set `mac.notarize: true` in `electron-builder.yml`, export
      `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, and a signing
      identity (`CSC_LINK` / `CSC_KEY_PASSWORD` or keychain), then re-run
      `build:mac`. Verify with `spctl -a -vvv "Hermes Cowork.app"`.
- [ ] Install the DMG on a clean machine, launch, run one Cowork task
      end to end (plan → approve → edit → revert), one two-worker task.

## Ship

- [ ] Tag `v<version>`, push the tag.
- [ ] Attach the DMG to the GitHub release; paste the changelog.
- [ ] Confirm the download link in `README.md` resolves.

## Upstream sync

The fork is `avedelphina/hermes-cowork` (upstream `frabbi0942/Hermes-Cowork`).

- Keep changes in small, reviewable commits with conventional-commit subjects.
- `git remote add upstream https://github.com/frabbi0942/Hermes-Cowork.git`
- Before a release, `git fetch upstream && git log --oneline main..upstream/main`
  and merge deliberately — re-run the full e2e suite after any upstream merge,
  since ACP / dashboard API shape is the main breakage risk.
