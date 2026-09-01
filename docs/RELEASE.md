# Release Process

adOmnia releases are driven by Git tags and GitHub Actions.

## v0.8.2 release notes: dependency refresh and sidebar follow

- Full dependency refresh across Go and the frontend, clearing every open
  Dependabot advisory. `wails/v3` and `@wailsio/runtime` moved together from
  `3.0.0-beta.7`/`3.0.0-beta.5` to `3.0.0-beta.16`, keeping the version lock the
  IPC layer depends on. gRPC, the MongoDB driver, Sarama, and amqp091-go were
  updated, along with transitive `golang.org/x/{crypto,net,text}` bumps.
- Frontend: `lucide-react` 1.38.0, `zustand` 5.0.15, `vitest` 4.1.11, and
  `rollup-plugin-visualizer` 7.1.1.
- The collection sidebar now follows the active tab: it expands the full
  collection/folder path of the selected request and scrolls the row into view,
  so a deeply nested request is no longer hidden. An active search is preserved.
- The active request row is easier to spot — accent-tinted surface, medium
  weight, and `aria-current="page"` for assistive technology.

Verified with `go build ./...`, `go vet ./...`, `go test ./...`,
`npm run build`, and `npm test` (69 files, 273 tests passing).

## v0.8.1 release notes: API Flow recording

- API Flow is a core workspace again and is available from the primary navigation.
- The REST/API Composer can record completed sends locally. `Record` captures each
  request in execution order; `Stop` opens a naming dialog and creates an editable,
  executable flow with Start, request nodes, and Stop.
- Recorded snapshots preserve request templates, request configuration, scripts,
  assertions, source request/environment metadata, and execution timing/status.
  Direct credential values are redacted; variable and Vault references remain
  replayable.
- Saved flows now use schema version 4. Existing flow data is migrated on load;
  exports can be imported again as Flow JSON or Mermaid.
- The Flow workspace supports an empty New Flow canvas, request/condition editing,
  response extraction, ordering recorded steps, replay from a selected node, and
  cancellation of a running replay.

## Release Outputs

The build workflow produces:

- `adOmnia-<version>-windows-amd64.exe`
- `adOmnia-<version>-linux-amd64`
- `adOmnia-<version>-linux-amd64.tar.gz`
- `adOmnia-<version>-macos-universal.dmg`
- `SHA256SUMS.txt`

## Pre-Release Checklist

- [ ] `frontend/npm run build` passes.
- [ ] `go test ./...` passes.
- [ ] App launches on at least the primary development platform.
- [ ] Main workflows are smoke-tested: request send, environments, mock/proxy if changed.
- [ ] UI changes have screenshots or visual review.
- [ ] [CHANGELOG.md](../CHANGELOG.md) has the release notes.
- [ ] [README.md](../README.md) download instructions are still accurate.

## Create a Release

Update changelog:

```bash
# Move [Unreleased] entries to the new version section.
git add CHANGELOG.md
git commit -m "chore: prepare release v0.1.0"
```

Create and push a tag:

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

GitHub Actions will:

1. Run checks.
2. Build Windows, Linux, and macOS artifacts.
3. Bundle artifacts and checksums.
4. Publish a GitHub Release for tags matching `v*`.

## CI Builds Without Release

Pushes to `master`, `main`, or `develop` produce downloadable Actions artifacts but do not create a public Release.

Find them in:

**Actions -> Build Desktop Artifacts -> successful run -> Artifacts**

## Known Packaging Notes

- Windows artifacts are unsigned unless code signing is configured.
- macOS artifacts are unsigned/not notarized unless Apple signing credentials are configured.
- Linux packages are portable artifacts, not `.deb`, `.rpm`, Snap, or AppImage yet.
