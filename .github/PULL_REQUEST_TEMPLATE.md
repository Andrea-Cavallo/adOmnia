---
name: Pull Request
about: Submit code changes
title: ''
labels: ''
assignees: ''
---

## Summary

Describe what changed and why.

## Product Impact

What user workflow improves? Include screenshots or recordings for UI changes.

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] UI/UX polish
- [ ] Documentation
- [ ] Build/release
- [ ] Refactor
- [ ] Security/privacy

## Verification

- [ ] `cd frontend && npm run build`
- [ ] `go test ./...`
- [ ] Manual smoke test performed
- [ ] Not applicable

Manual test notes:

## Risk

- [ ] Low: isolated change
- [ ] Medium: shared UI/state/build behavior
- [ ] High: storage, workspace format, security, release pipeline, or network behavior

## Checklist

- [ ] The change preserves local-first behavior.
- [ ] User-facing behavior is documented.
- [ ] Screenshots are included for visible UI changes.
- [ ] `CHANGELOG.md` is updated under `[Unreleased]` if release-worthy.
- [ ] Secrets, tokens, cookies, and private URLs are not included in logs/screenshots.

## Related Issues

Fixes #
