# adOmnia — v1 acceptance checklist

Release cycle: `v0.10.0-beta.N` → `v1.0.0-rc.N` → `v1.0.0`.
Mark a gate complete only with dated evidence, platform and tested artifact/commit.
Automated checks do not replace desktop acceptance. Release tags identify reviewed batches, not individual pushes.

## Scope

The v1 baseline is the existing local-first API workbench and Go Studio, with the shipped supporting studios. LAN collaboration remains explicitly beta until its two-machine gates pass; advanced P1/P2 collaboration is future work and does not block v1 if clearly labeled unavailable.

## Automated validation

- [x] Frontend suite: 1,311 tests in 296 files passed on 2026-10-10, before release metadata changes.
- [x] Beta release tree passes TypeScript, frontend build and startup budget (592,827 initial JavaScript bytes), 2026-10-10. Commit/tag verification is recorded after publication.
- [x] Go build and affected packages (`devcontext`, `goide`, `ide/run`, `collab`, `collectionfs`) pass on 2026-10-10; Go Studio suite takes 121.6 seconds on this host.
- [x] Full Go suite passed on Windows, 2026-10-11: go test -count=1 -timeout=10m ./..., including git, goide and update. Evidence: .artifacts/v1-go-tests.log.
- [ ] CI produces Windows, Linux and macOS artifacts for the exact release tag with checksums.

## Desktop acceptance — blockers

- [x] Signed updater implemented: automatic channel checks, verified downloads, install-on-exit and Windows fixture rollback; details/evidence in `UPDATER.md` (2026-10-10).
- [ ] Packaged updater acceptance on supported platforms and preservation of real workspaces; complete the native gates in `UPDATER.md` before v1.

- [ ] Clean install and first launch of packaged Windows build; no missing fonts/assets or startup errors.
- [ ] HTTP request/response: methods, URL/parameters, headers, auth, body, errors, timeout and cancellation.
- [ ] Collections: create/edit/save, restart persistence, import/export round trip and migration of an existing workspace.
- [ ] Environments: selection, substitution, private variables and vault secrets; exports redact secrets by default.
- [ ] API tabs: switch, rename, overflow, reorder/detach, shortcuts and unsaved-change handling.
- [ ] Dark/White and custom palettes: labels, Nothing error states, editor and terminal remain readable.
- [ ] Go Studio: open project, edit/save, diagnostics, run/test/debug and terminal; start workspace tasks in order and stop safely on failure.
- [ ] Supporting studios: smoke test each module exposed in navigation; mark experimental features explicitly.
- [ ] Recovery: restart after interrupted work, preserve saved data and show actionable errors without silent overwrites.
- [ ] Privacy: no unexpected network calls, logging/export do not disclose credentials; execution and sharing require the intended permissions.
- [ ] Packaged Linux/macOS smoke tests, or explicitly narrow supported v1 platforms before release.
- [ ] README, feature catalog, known limitations and release notes match actual shipped behavior.

## Conditional collaboration acceptance

- [ ] Complete A1–A7 in `mds/ADOMNIA-COLLABORATION-TODO.md` before presenting LAN collaboration as stable.
- [ ] Otherwise retain the beta label and document in-memory resume and remaining two-machine checks.

## Promotion

- [ ] RC: scope frozen, all desktop blockers resolved, no known data-loss or secret-disclosure defects.
- [ ] v1: exact RC artifact accepted, install/update verified, checksums published and support boundaries documented.

## Tag cleanup

On 2026-10-10 the user requested retirement of all previous local/remote tags and GitHub releases. Historical changelogs stay in Git. An external backup contains Git history, local and remote tag references and release metadata; it does not archive installer assets.

## Candidate audit — 2026-10-11 (Windows working tree)

- [x] Full frontend suite: 311 files / 1,357 tests, TypeScript/Vite and startup budget 598,669 bytes passed. Local tree includes fixes beyond main 1bc2b77; not yet a tagged artifact.
- [x] Tag workflow prepared with three updater ZIPs, signed manifest, startup budget and Linux installer tests; YAML/package contract checked locally.
- [x] Full Go suite and go build ./... passed locally on 2026-10-11.
- [ ] Exact candidate CI evidence after the reviewed push.
- [ ] Native installer/update and desktop acceptance remain blocking; installation scripts do not replace Windows Setup/MSI or macOS notarization.
