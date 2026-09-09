# Release Process

adOmnia releases are driven by Git tags and GitHub Actions.

## v0.9.6 release notes: Log Inspector reliability pass

See [the full v0.9.6 notes](releases/v0.9.6.md). This is the public release for
the Log Inspector reliability pass: trace-only chains, recovered retry outcomes,
observed-window durations, `attributes.http.*` payloads, source provenance and
a Linux CI packaging fix.

## v0.9.5 release notes: Log Inspector reliability pass

Superseded by `v0.9.6` after the tag workflow failed on an external Ubuntu apt
mirror before release publication. See [the archived notes](releases/v0.9.5.md).

## v0.9.4 release notes: multi-file Log Inspector

See [the full v0.9.4 notes](releases/v0.9.4.md) for cross-file correlation,
dedicated request/response payload inspection, source-file search and columns
that adapt to the fields actually present in the imported logs.

## v0.9.3 release notes: request-level Log Inspector analysis

See [the full v0.9.3 notes](releases/v0.9.3.md) for end-to-end request grouping,
deterministic timeout and HTTP classification, enterprise slog/zap fields,
sensitive-data findings and reliable overlapping import cancellation.

## v0.9.2 release notes: faster log search and nested JSON

See [the full v0.9.2 notes](releases/v0.9.2.md) for automatic field discovery
and remembered log shapes, payload-key search, regular expressions and
alternatives, the widened field aliases, recursive nested-JSON unwrapping and the
rebuilt Log Inspector empty state.

## v0.9.1 release notes: first-class Log Inspector

See [the full v0.9.1 notes](releases/v0.9.1.md) for the dedicated Power Tools
navigation and the complete local log investigation workflow.

## v0.9.0 release notes: Log Inspector

See [the full v0.9.0 notes](releases/v0.9.0.md) for supported formats,
investigation workflow, correlation, large-file behavior and verification.

## v0.8.3 release notes: reliable recording and fluid flow panels

See [the full v0.8.3 notes](releases/v0.8.3.md) for recording, response mappings,
canvas/panel controls, compatibility and verification details.

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

Update the desktop version in `build/config.yml`, both npm manifests and their
lockfiles, and `CHANGELOG.md`. Write the public release body in
`docs/releases/<tag>.md`; the tag build publishes that file as its release notes.
Older tags without a notes file retain generated GitHub notes.

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
