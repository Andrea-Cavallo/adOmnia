# Installer and update verification — 2026-11-02

Implementation branch: `feat/installer-updates`, based on `main` after v1.0.23.
This work does not create a public release or change an existing tag.

## Verified locally

| Check | Result |
| --- | --- |
| NSIS 3.11 compilation using the existing adOmnia icon and numeric Windows resources | Passed |
| Microsoft Evergreen bootstrapper Authenticode identity check | Passed |
| Actual Windows silent installation into a user-owned path containing spaces | Passed |
| Start menu shortcut, install location and Windows uninstall registration | Passed |
| Reinstall and refusal to replace an exclusively locked application (exit code 3) | Passed |
| Actual silent uninstall, preserving unrelated files in the installation directory and a workspace fixture outside it | Passed |
| `go test ./internal/update/ -count=1 -timeout 120s` (including real Windows helper swap/startup/rollback tests) | Passed |
| Windows registry metadata ownership: registered executable updates its version, portable and dev copies do not | Passed |
| Cached download signature, version, hash and path validation | Passed |
| Full frontend suite | 499 files, 2,467 tests passed |
| TypeScript, production frontend build and startup budget | Passed |
| `go vet ./internal/update/` | Passed |
| Frontend lint | Passed with existing warnings |
| Actionlint 1.7.12 for both modified release workflows; PowerShell parsing | Passed |
| Browser fixture using the actual update components and stores | Passed: editor focus retained, no modal, indeterminate progress without a known size, automatic-install consent and postpone behavior, no overflow at 390 px, no page errors |
| Browser screenshot inspection | Passed on local dark desktop and narrow layouts; fixtures are under ignored `frontend/.artifacts/` |

## Acceptance still required

- [ ] Review the native setup wizard at normal and high DPI, including its Italian standard pages.
- [ ] Install on a Windows account without an existing WebView2 runtime, including offline/error behavior.
- [ ] Exercise a published release-to-release update in the desktop UI with unsaved files, detached windows and running tasks. Unit/integration helper tests do not establish this desktop acceptance.
- [ ] Run the modified workflows remotely and inspect their published setup, signed update packages, manifest and checksums.
- [ ] Apply and verify publisher Authenticode signing when a certificate is available. The current setup is unsigned; Microsoft signs only its embedded WebView2 bootstrapper. The application's Ed25519 updater identity is separate.

## Policy and compatibility

Existing automatic-check and automatic-download preferences keep their meaning.
`general.installUpdatesOnExit` is optional and defaults to false, so older settings
remain valid. Enabling it in Settings explicitly authorizes future verified
installations on normal exit and enables downloads. Postponing a scheduled update
also disables that automatic-install preference. No update force-closes an editor
or bypasses the existing save and running-task guards.

Completed update packages can be reused after restart within the existing cache
retention window. Their signature, selected release version and archive hash are
revalidated. The helper extracts the signed archive afresh before replacing the
application; it does not execute cached extracted files.

OpenIDEA reference inspected at commit
`3be40bd57c5718df39977c5f8b5d31f0ff3e692a`: NSIS bundle configuration,
signed updater artifacts, background progress/cancellation and guarded restart.
No upstream source was copied; the implementation extends adOmnia's Wails/Go
updater instead of importing Tauri-specific code.

## Local preview artifact

`dist/adomnia-1.0.23+installer-preview-windows-amd64-setup.exe` was compiled from the updated production frontend and Go backend with the existing app icon and version resources, then passed the installer acceptance script. Its SHA-256 is recorded in the adjacent `.sha256` file. It is a local preview, not a published v1.0.23 asset.
