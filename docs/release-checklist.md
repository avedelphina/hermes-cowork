# Release checklist

## Pre-release

- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` clean (CI green).
- [ ] `pnpm -r build` clean.
- [ ] e2e against a real Hermes 0.20.6:
  - [ ] `pnpm --filter @hermes-cowork/desktop exec playwright test` — smoke,
        projects, cowork-flow all pass.
- [ ] Clean-machine check: fresh clone, `corepack enable`, `nvm use`,
      `pnpm install`, `pnpm --filter @hermes-cowork/desktop dev` launches with
      no manual steps (no `node_modules` surgery).
- [ ] Bump `version` in `package.json` and `apps/desktop/package.json`.
- [ ] Add a `CHANGELOG.md` section for the version.
- [ ] Update `README.md` status line and `docs/acp-notes.md` if the tested
      Hermes version changed; bump `MIN_HERMES_VERSION` only against a version
      actually exercised.

## Signing + notarisation

`apps/desktop/electron-builder.yml` carries `hardenedRuntime: true`, the
entitlements at `apps/desktop/build/entitlements.mac.plist`, and
`publish: github`. `notarize` is left `false` in the file so a plain
`pnpm build:mac` needs no credentials; pass `--config.mac.notarize=true` to
turn it on.

Signing identity in the login keychain:
`Developer ID Application: TOMÁŠ KRÁČMAR (P32JC2N6Y9)` — Team ID `P32JC2N6Y9`.
electron-builder auto-discovers it (`CSC_IDENTITY_AUTO_DISCOVERY` default).

### CI workflow (preferred)

`.github/workflows/release.yml` runs on a pushed `v*` tag:

1. `prepare` — fails unless the tagged commit is on `main` and the tag matches
   both `package.json` versions; runs typecheck/lint/test/build; creates a
   draft GitHub release with auto-generated notes.
2. `release-mac` — `electron-builder --mac --arm64 --publish always
   --config.mac.notarize=true`: signs with the Developer ID cert from
   `CSC_LINK`, notarises via `notarytool`, staples, uploads the DMG + zip +
   `latest-mac.yml` + blockmaps, then verifies `codesign` / `spctl` /
   `stapler`.
3. `release-linux` — builds the x64 AppImage and uploads it with
   `latest-linux.yml`.
4. `publish` — only if both platform jobs passed, un-drafts the release and
   marks it latest. If either fails, the draft stays unpublished: fix and
   re-run the failed jobs (or delete the draft and re-tag).

PRs that touch packaging (`apps/desktop/electron-builder.yml`, `build/`,
`package.json`, the lockfile, `.github/`) also build an unsigned DMG and
AppImage in `ci.yml`, so packaging breaks before merge, not at release time.

Repository secrets (already set — Settings → Secrets and variables → Actions;
the Linux build needs none):
`CSC_LINK` (base64 of the Developer ID `.p12`), `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

So a release is just:

```bash
git tag v<version> && git push origin v<version>
```

### Local build (fallback)

On a Mac with the Developer ID identity in the login keychain
(`Developer ID Application: TOMÁŠ KRÁČMAR (P32JC2N6Y9)`), and a stored
notary profile — one-time:

```bash
xcrun notarytool store-credentials hermes-notary \
  --apple-id "<apple account email>" --team-id P32JC2N6Y9
# paste the app-specific password at the prompt (not on the command line)
```

then per build:

```bash
pnpm --filter @hermes-cowork/desktop exec electron-builder \
  --mac --arm64 --config.mac.notarize=true --config.mac.notarize.keychainProfile=hermes-notary
```

Output: `apps/desktop/release/Hermes-Cowork-<version>-arm64.dmg` plus
`latest-mac.yml` and `.blockmap`. Verify:

```bash
app="apps/desktop/release/mac-arm64/Hermes Cowork.app"
codesign --verify --deep --strict --verbose=2 "$app"
spctl -a -vvv -t install "$app"          # expect: "source=Notarized Developer ID"
xcrun stapler validate "$app"
```

Never `export APPLE_APP_SPECIFIC_PASSWORD` on a shared machine — it shows up
in `ps` output. Use the keychain profile.

## Post-package smoke

- [ ] Install the DMG on a clean machine, double-click launch (no quarantine
      workaround), run one Cowork task end to end (plan → approve → edit →
      revert).
- [ ] `codesign` / `spctl` / `stapler` checks above pass on the shipped DMG's
      app.

## Ship

- [ ] Merge the release branch to `main`; the tag must sit on a `main` commit
      whose `package.json` version equals the tag.
- [ ] `git tag v<version> && git push origin v<version>` — the Release
      workflow builds both platforms and publishes automatically.
- [ ] Optionally replace the auto-generated release notes with the
      `CHANGELOG.md` section (`gh release edit v<version> --notes-file …`).
- [ ] (Local fallback only) `gh release create v<version>
      "apps/desktop/release/Hermes-Cowork-<version>-arm64.dmg"
      "apps/desktop/release/latest-mac.yml" ... --title "Hermes Cowork v<version>"`.
- [ ] Confirm the download link in `README.md` resolves to the new DMG.

## Upstream sync

The fork is `avedelphina/hermes-cowork` (upstream `frabbi0942/Hermes-Cowork`).

- Keep changes in small, reviewable commits with conventional-commit subjects.
- `git remote add upstream https://github.com/frabbi0942/Hermes-Cowork.git`
- Before a release, `git fetch upstream && git log --oneline main..upstream/main`
  and merge deliberately — re-run the full e2e suite after any upstream merge,
  since ACP / dashboard API shape is the main breakage risk.
