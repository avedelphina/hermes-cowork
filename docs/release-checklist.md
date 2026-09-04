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

## Signing + notarisation

`apps/desktop/electron-builder.yml` carries `hardenedRuntime: true`, the
entitlements at `apps/desktop/build/entitlements.mac.plist`, and
`publish: github`. `notarize` is left `false` in the file so a plain
`pnpm build:mac` needs no credentials; pass `--config.mac.notarize=true` to
turn it on.

Signing identity in the login keychain:
`Developer ID Application: TOMÁŠ KRÁČMAR (P32JC2N6Y9)` — Team ID `P32JC2N6Y9`.
electron-builder auto-discovers it (`CSC_IDENTITY_AUTO_DISCOVERY` default).

### Local build (current method)

```bash
export APPLE_ID="<apple account email>"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com
export APPLE_TEAM_ID="P32JC2N6Y9"

pnpm --filter @hermes-cowork/desktop exec electron-builder \
  --mac --arm64 --config.mac.notarize=true
```

Notarisation adds a few minutes (electron-builder waits on `notarytool` and
staples the ticket). Output:
`apps/desktop/release/Hermes Cowork-<version>-arm64.dmg` plus
`latest-mac.yml` and `.blockmap`.

Verify the shipped artifact:

```bash
app="apps/desktop/release/mac-arm64/Hermes Cowork.app"
codesign --verify --deep --strict --verbose=2 "$app"
spctl -a -vvv -t install "$app"          # expect: "source=Notarized Developer ID"
xcrun stapler validate "$app"
```

### CI workflow (later)

A tag-triggered `.github/workflows/release.yml` can do the same on a
`macos-14` runner. Secrets needed: `CSC_LINK` (base64 of the exported
Developer ID `.p12`), `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Deferred until the local
flow has produced at least one good release.

## Post-package smoke

- [ ] Install the DMG on a clean machine, double-click launch (no quarantine
      workaround), run one Cowork task end to end (plan → approve → edit →
      revert) and one two-worker task.
- [ ] `codesign` / `spctl` / `stapler` checks above pass on the shipped DMG's
      app.

## Ship

- [ ] Merge the release branch to `main`; the tag must sit on a `main` commit
      whose `package.json` version equals the tag.
- [ ] `git tag v<version> && git push origin v<version>`.
- [ ] `gh release create v<version> "apps/desktop/release/Hermes Cowork-<version>-arm64.dmg" \
        --title "Hermes Cowork v<version>" --notes-file <changelog section>`
      (also attach `latest-mac.yml` + the `.blockmap` for a future updater).
- [ ] Confirm the download link in `README.md` resolves to the new DMG.

## Upstream sync

The fork is `avedelphina/hermes-cowork` (upstream `frabbi0942/Hermes-Cowork`).

- Keep changes in small, reviewable commits with conventional-commit subjects.
- `git remote add upstream https://github.com/frabbi0942/Hermes-Cowork.git`
- Before a release, `git fetch upstream && git log --oneline main..upstream/main`
  and merge deliberately — re-run the full e2e suite after any upstream merge,
  since ACP / dashboard API shape is the main breakage risk.
