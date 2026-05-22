# Release Process

adOmnia releases are driven by Git tags and GitHub Actions.

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
