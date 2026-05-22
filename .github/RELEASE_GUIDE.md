# Quick Release Guide

This guide provides a step-by-step checklist for releasing a new version of adOmnia.

## Pre-Release Checklist

- [ ] All planned features/fixes for this version are merged
- [ ] All tests pass on Windows, macOS, and Linux
- [ ] No known critical bugs
- [ ] Documentation is up to date
- [ ] CHANGELOG.md has all changes under `[Unreleased]`
- [ ] Security review complete (if needed)

## Release Steps

### 1. Prepare Release Branch
```bash
# Ensure main branch is up to date
git checkout main
git pull origin main

# Create release branch (optional)
git checkout -b release/v1.0.0
```

### 2. Update Version Numbers
Update these locations if manually versioning:
- [ ] CHANGELOG.md (move `[Unreleased]` to `[1.0.0] - YYYY-MM-DD`)
- [ ] README.md (if version mentioned)
- [ ] Any other documentation

```bash
# Commit changes
git add .
git commit -m "chore: prepare release v1.0.0"
git push origin release/v1.0.0
```

### 3. Build and Test

**Option A: Using release script (recommended)**
```bash
# Dry run first
./release.sh 1.0.0 --dry-run

# Actual release
./release.sh 1.0.0
```

**Option B: Manual build**
```bash
# Build all platforms
./build.sh all 1.0.0

# Or on Windows
.\build.ps1 -Target all -Version "1.0.0"

# Or with Makefile
make release VERSION=1.0.0
```

### 4. Test Binaries
Test each binary on its target platform:
- [ ] Windows: `adOmnia-<version>-windows-amd64.exe`
- [ ] macOS: `adOmnia-<version>-macos-universal.dmg`
- [ ] Linux: `adOmnia-<version>-linux-amd64`
- [ ] Linux package: `adOmnia-<version>-linux-amd64.tar.gz`

**Basic smoke tests:**
1. Application launches
2. Can create a new request
3. Can send a GET request to https://httpbin.org/get
4. Response displays correctly
5. Can save to collection
6. WebSocket connection works (wss://echo.websocket.org)

### 5. Create Git Tag
```bash
# Create annotated tag
git tag -a v1.0.0 -m "Release v1.0.0"

# Verify tag
git tag -l -n9 v1.0.0

# Push tag (triggers GitHub Actions)
git push origin v1.0.0
```

### 6. Monitor GitHub Actions
1. Go to: https://github.com/Andrea-Cavallo/adOmnia/actions
2. Wait for build workflow to complete
3. Verify all platform builds succeeded
4. Check that release was created automatically

### 7. Create/Edit GitHub Release

If using automated release:
```bash
# Edit the auto-generated release
gh release edit v1.0.0 --draft=false
```

If creating manually:
```bash
# Create release with artifacts
gh release create v1.0.0 ./dist/* \
  --title "adOmnia v1.0.0" \
  --notes-file .github/RELEASE_TEMPLATE.md
```

**Release notes should include:**
- Summary of changes
- New features
- Bug fixes
- Breaking changes (if any)
- Upgrade instructions
- Known issues
- Download links
- SHA256 checksums

### 8. Verify Release
- [ ] Release page shows all binaries
- [ ] SHA256SUMS.txt is present
- [ ] Release notes are clear and complete
- [ ] Download links work
- [ ] Checksums match: `sha256sum -c SHA256SUMS.txt`

### 9. Post-Release Tasks

#### Update Documentation
- [ ] Add release announcement to README.md (if needed)
- [ ] Update any version-specific documentation
- [ ] Create blog post (if applicable)

#### Announce Release
- [ ] Twitter/X announcement
- [ ] Reddit (r/golang, r/webdev)
- [ ] Hacker News (for major releases)
- [ ] Discord/Slack communities
- [ ] Project website/blog

#### Monitor Feedback
- [ ] Watch GitHub issues for bug reports
- [ ] Monitor download metrics
- [ ] Respond to user feedback

#### Prepare Next Version
```bash
# Switch back to main
git checkout main
git merge release/v1.0.0
git push origin main

# Update CHANGELOG.md with [Unreleased] section
# Add next version placeholder
```

## Hotfix Release (Emergency Patch)

For critical bugs in production:

### 1. Create Hotfix Branch
```bash
# Branch from the release tag
git checkout -b hotfix/v1.0.1 v1.0.0
```

### 2. Fix the Bug
```bash
# Make minimal changes to fix the issue
git add .
git commit -m "fix: critical bug in X"
```

### 3. Update CHANGELOG
```markdown
## [1.0.1] - YYYY-MM-DD

### Fixed
- Critical bug in X feature
```

### 4. Build and Release
```bash
# Build
./build.sh all 1.0.1

# Tag
git tag -a v1.0.1 -m "Hotfix release v1.0.1"
git push origin v1.0.1

# Create release
gh release create v1.0.1 ./dist/* \
  --title "adOmnia v1.0.1 (Hotfix)" \
  --notes "Critical fix for issue #123"
```

### 5. Merge Back
```bash
# Merge hotfix to main
git checkout main
git merge hotfix/v1.0.1
git push origin main

# Delete hotfix branch
git branch -d hotfix/v1.0.1
```

## Pre-Release / Beta Versions

For testing before official release:

```bash
# Create beta tag
git tag -a v1.1.0-beta.1 -m "Beta release v1.1.0-beta.1"
git push origin v1.1.0-beta.1

# Create pre-release
gh release create v1.1.0-beta.1 ./dist/* \
  --title "adOmnia v1.1.0 Beta 1" \
  --prerelease \
  --notes "Beta release for testing. Not recommended for production."
```

## Rollback Procedure

If a release has critical issues:

### 1. Identify the Problem
- Document the issue
- Assess impact
- Decide if rollback is necessary

### 2. Mark Release as Broken
```bash
# Edit release to add warning
gh release edit v1.0.0 --notes "⚠️ WARNING: This release has known issues. Please use v0.9.0 instead."
```

### 3. Create Hotfix
Follow hotfix procedure above, or revert to previous version.

### 4. Communicate
- Update GitHub release notes
- Post announcement
- Email users (if applicable)

## Troubleshooting

### Build Fails on One Platform
- Check platform-specific dependencies
- Review build logs in GitHub Actions
- Test locally on that platform
- Consider excluding platform temporarily

### GitHub Actions Not Triggering
- Verify tag format: `v1.0.0` (must start with 'v')
- Check workflow file syntax
- Ensure actions are enabled in repository settings

### Release Artifacts Missing
- Check if build workflow completed successfully
- Verify artifact upload step in workflow
- Manually upload missing artifacts if needed

## Checklist Summary

**Pre-Release:**
- [ ] Code complete
- [ ] Tests pass
- [ ] Documentation updated
- [ ] CHANGELOG updated

**Release:**
- [ ] Version bumped
- [ ] Binaries built and tested
- [ ] Git tag created and pushed
- [ ] GitHub release created
- [ ] Release notes published

**Post-Release:**
- [ ] Announcement made
- [ ] Next version planned
- [ ] Monitoring for issues

## Resources

- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [GitHub CLI Docs](https://cli.github.com/manual/)
- [Go Build Tags](https://pkg.go.dev/cmd/go#hdr-Build_constraints)

---

**Questions?** Open a discussion: https://github.com/Andrea-Cavallo/adOmnia/discussions
