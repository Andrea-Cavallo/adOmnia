# Signed application updater

The updater is implemented in `internal/update`, with thin Wails bindings in `update.go`. Settings → About exposes channel selection, automatic checks/downloads, progress, cancellation and install-on-exit.

## Behavior

- After the first stable UI frame, wait 15 seconds before the initial automatic check. Check every six hours while the app is open and visible; use an ETag and a persisted six-hour metadata cache. Manual checks bypass the time cache and retain conditional requests.
- Follow the installed version's channel by default: prerelease builds receive beta and stable releases; stable builds receive stable releases. Drafts, invalid versions and releases without a signed updater manifest are skipped. SemVer prerelease ordering is preserved.
- Respect the global offline/proxy/CA policy. Downloads stream in 256 KiB buffers, with bounded package size, progress and cancellation. This initial implementation downloads full ZIPs; interrupted transfers restart, without delta or partial-range resume.
- Verify the Ed25519 signed manifest against the public publisher identity embedded in the app. Verify exact archive size and SHA256 before extraction; reject symlinks, traversal, special files and oversized archives. Recheck the signed archive in the helper before applying it. Restrict URLs and redirects to the publisher's GitHub release infrastructure.
- With automatic download enabled, a verified package is scheduled for normal application shutdown. It never forces the app closed: existing unsaved-file and active-process guards remain responsible for closing. Users can postpone the update.
- After services/storage close and the original process exits, a copied helper swaps the executable or macOS bundle on the same filesystem, retaining the previous version. The new app must confirm its embedded version and first stable UI frame within 90 seconds; failed startup restores the previous installation.
- Record failed apply attempts locally and pause automatic retries for that release. A manual check can explicitly retry it; a different newer release is still eligible. Expired private download/staging files are cleaned after seven days.

## Platforms and boundaries

- Windows: writable standalone/per-user executable installs; no elevation. A real installer and Authenticode signing remain separate delivery gates.
- Linux: writable portable installs. Never overwrite installations under `/usr`, `/opt`, `/snap` or Flatpak; those require package-manager updates. Native `.deb`/`.rpm` repositories remain separate work.
- macOS: replace the full `adomnia.app` bundle, never just its executable. Check the bundle with `codesign` before applying it. Apple Developer ID signing/notarization and packaged Mac acceptance remain required for professional distribution.
- Unsupported architectures do not receive a package. Current CI artifacts cover Windows/Linux amd64 and universal macOS.
- The running old beta has no updater; users must install the first updater-enabled release once. Future releases must publish all three signed packages before clients consider them installable.

## Publisher keys and CI

`internal/update/trust.go` contains only the public key. The matching private key is stored outside the repository and as GitHub Actions secret `ADOMNIA_UPDATE_SIGNING_KEY`. It is never included in an app, asset or log. `cmd/update-manifest` signs the three updater ZIPs and checks that the signing key matches the compiled publisher identity. The manifest is published alongside release artifacts/checksums only after all platform builds complete.

Publisher key backup on this workstation: `C:\Users\Andrea\.codex\adomnia-publisher-keys`. Keep it private and recoverable. Key rotation requires a separately reviewed trust transition; deleting release tags does not reset publisher identity.

## Settings compatibility

Three optional fields are added to `general`: `autoCheckUpdates`, `autoDownloadUpdates`, `updateChannel`. Existing settings merge with defaults; no workspace format migration is needed. Defaults enable automatic checks and verified download/install-on-exit, using the installed version's channel.

## Acceptance

Verified on Windows, 2026-10-10: Go updater tests with race detector and native fixture replacement/rollback, Go build, 1,318 frontend tests across 297 files, TypeScript/Vite build and startup budget (594,428 initial JavaScript bytes). Browser UI preview is in `.artifacts/updater-settings.png`; it is not packaged Wails acceptance.

- [x] SemVer beta ordering, signed manifest/tamper rejection, archive traversal/symlink rejection and platform URL allowlist tests.
- [x] Verified streaming download succeeds; a bad checksum cannot become ready.
- [x] Real Windows executable swap and failed-start rollback in an isolated fixture, race detector enabled.
- [x] Frontend checks: startup delay, six-hour window, channel selection, no unsigned downloads, coalesced requests, disabled checks and scheduling after verification.
- [x] Publisher signing fixture: three platform manifests signed using the CI publisher key and verified against the embedded public identity.
- [ ] Packaged Wails-to-Wails update with actual dirty-editor/active-process close guards and workspace/settings preserved.
- [ ] End-to-end GitHub signed release download with offline/cancellation/failed-transfer recovery.
- [ ] Native Linux portable update and package-manager boundary acceptance.
- [ ] Native signed/notarized macOS bundle update and rollback.
- [ ] Windows Authenticode and real installer integration; Linux repository integration.

Do not mark the updater production-ready until those packaged/native acceptance gates pass.
