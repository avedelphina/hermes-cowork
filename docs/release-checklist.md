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
- [ ] Add a `CHANGELOG.md` section for the version.
- [ ] Update `README.md` status line and `docs/acp-notes.md` if the tested
      Hermes version changed; bump `MIN_HERMES_VERSION` only against a version
      actually exercised.
- [ ] Merge the release branch to `main` first — the tag must point at a
      commit on `main` whose `package.json` version equals the tag.

## Signing + notarisation (configured)

`apps/desktop/electron-builder.yml` carries `hardenedRuntime: true`, the
entitlements at `apps/desktop/build/entitlements.mac.plist`, and
`publish: github`. Notarisation is left `false` in the file so a plain
`pnpm build:mac` needs no credentials; the release path turns it on.

### Automated (preferred)

`.github/workflows/release.yml` runs on a pushed `v*` tag: it re-runs the
checks, then `electron-builder --mac --arm64 --publish always
--config.mac.notarize=true`, which signs, notarises, and creates a **draft**
GitHub release with the DMG + `latest-mac.yml` + `.blockmap`.

One-time repository secrets (Settings → Secrets and variables → Actions):

| secret | what |
| --- | --- |
| `CSC_LINK` | base64 of the exported **Developer ID Application** `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | password set when exporting that `.p12` |
| `APPLE_ID` | Apple account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from appleid.apple.com, for `notarytool` |
| `APPLE_TEAM_ID` | 10-char Team ID (Apple Developer → Membership) |

Then:

```bash
git tag v<version> && git push origin v<version>
```

Watch the run, then review and publish the draft release.

### Local (fallback / first run)

On a Mac with the Developer ID identity in the login keychain:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
pnpm --filter @hermes-cowork/desktop exec electron-builder \
  --mac --arm64 --config.mac.notarize=true
```

Produces `apps/desktop/release/Hermes Cowork-<version>-arm64.dmg`. Verify:

```bash
codesign --verify --deep --strict --verbose=2 "apps/desktop/release/mac-arm64/Hermes Cowork.app"
spctl -a -vvv -t install "apps/desktop/release/mac-arm64/Hermes Cowork.app"
```

Then attach the DMG (and `latest-mac.yml`, `.blockmap`) to the GitHub release.

## Post-package smoke

- [ ] Install the DMG on a clean machine, double-click launch (no quarantine
      workaround), run one Cowork task end to end (plan → approve → edit →
      revert) and one two-worker task.
- [ ] `spctl` / `codesign` checks above pass on the shipped artifact.

## Ship

- [ ] Publish the draft GitHub release; paste the `CHANGELOG.md` section.
- [ ] Confirm the download link in `README.md` resolves to the new DMG.

## Upstream sync

The fork is `avedelphina/hermes-cowork` (upstream `frabbi0942/Hermes-Cowork`).

- Keep changes in small, reviewable commits with conventional-commit subjects.
- `git remote add upstream https://github.com/frabbi0942/Hermes-Cowork.git`
- Before a release, `git fetch upstream && git log --oneline main..upstream/main`
  and merge deliberately — re-run the full e2e suite after any upstream merge,
  since ACP / dashboard API shape is the main breakage risk.
