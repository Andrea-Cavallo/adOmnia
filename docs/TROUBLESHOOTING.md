# Troubleshooting

Common failures and what to check first. If a step here does not solve the
problem, include the app version (**Settings → About**), your OS and the exact
message in the report; [SUPPORT.md](../SUPPORT.md) lists the channels.

## The app does not start

**Windows, "WebView2 Runtime is missing".** adOmnia renders its interface with
Microsoft Edge WebView2. The installer offers Microsoft's download page and can
run the bundled Evergreen bootstrapper, which needs internet access. Install the
runtime, then start adOmnia again.

**Windows, "Windows protected your PC".** Releases are Authenticode-signed only
when the repository has a code-signing certificate configured. For a file
downloaded from this repository's releases, choose **More info → Run anyway**, and
compare it with the release `SHA256SUMS.txt` when unsure.

**macOS, "cannot be opened because the developer cannot be verified".** Builds are
not notarized yet: right-click the app and choose **Open** once, or run
`xattr -dr com.apple.quarantine /Applications/adomnia.app`.

**Linux, missing shared libraries.** Install the GTK/WebKitGTK runtime packages:
`libgtk-3-dev` and `libwebkit2gtk-4.1-dev` for the packaged `gtk3` build, or
`libgtk-4-dev` and `libwebkitgtk-6.0-dev` for a local `./build.sh` build. The
details and the exact tag selection are in [BUILD.md](BUILD.md).

**A second launch shows no window.** adOmnia is single-instance: a second start
hands its request to the running copy. If no window appears within a few seconds,
close every `adomnia` process, then start it again; a crash report with what was
running is worth more than a retry loop.

## Builds and checks fail

- **Wrong toolchain.** `go.mod` pins the Go version and `docs/BUILD.md` pins the
  Wails CLI (`v3.1.0`). `node scripts/check-wails-version.mjs` fails when a
  document or workflow names a different Wails version.
- **Version mismatch inside the repository.** `node scripts/check-version-consistency.mjs`
  compares `build/config.yml`, both npm manifests and both lockfiles; a partial
  version bump is refused before a tag is cut.
- **Frontend build or tests.** `npm --prefix frontend run build` and
  `npm --prefix frontend test`; the startup budget check is
  `npm --prefix frontend run check:startup`.
- **Linux package build.** The `gtk3` compatibility tag is what releases ship:
  `LINUX_BUILD_TAGS='production gtk3' ./build.sh`.

## Updates

- **No update is offered.** Development builds never update, and the installed
  build must trust the key that signed the release; releases without
  `update-manifest.json` are not offered. Read-only install locations
  (`/usr`, `/opt`, Snap, Flatpak, Scoop/Homebrew) cannot be updated in place:
  adOmnia shows the release and a download link instead.
- **An update failed and the previous build is back.** The updater keeps the
  previous application and restores it when the new build does not confirm a
  successful startup. Script-based installs keep `PATH.adomnia-previous` and have
  no automatic rollback: rename the backup back, or reinstall the release.
- **Signature or checksum refused.** Nothing is installed. Re-download from the
  release page; a checksum mismatch means the download is corrupt, and a signature
  failure means the file is not the published one.

## Code Studio

- **Run, Test or Debug does nothing.** Every process starts only on an explicit
  action on a trusted project. Trust the project first, then check that the
  toolchain it needs is installed: language servers, Delve, debugpy, CodeLLDB or
  `rust-analyzer` are installed by explicit, pinned actions, never silently.
- **Diagnostics are missing for one unit.** Each project unit gets its own
  language server; a second environment (another virtualenv, toolchain or Cargo
  target) has its own server, so "Clean analyzer cache" for that unit is the
  first step.
- **The first Quick Open is slow on a large repository.** Symbols appear while the
  background index builds; the file tree is usable before the symbol index is
  ready. Measured baselines are in [PERFORMANCE.md](PERFORMANCE.md).

## Your data

Workspaces, collections and settings stay local (bbolt, `localStorage` and
`.adomnia` files). On Windows the application data lives in `%APPDATA%\adomnia`;
uninstalling keeps it unless **Also delete my data** is ticked. Project state
under `.adomnia/` restores the documents and layout of the last session after a
crash or kill. Back up a workspace by exporting the `.adomnia` file before large
migrations.
