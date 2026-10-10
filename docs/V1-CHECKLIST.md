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
- [ ] Full Go suite without timeouts: initial 60-second run timed out in `git` and `goide`; the isolated cherry-pick test and longer Go Studio run pass. Git suite recheck remains a release acceptance gate until recorded.
- [ ] CI produces Windows, Linux and macOS artifacts for the exact release tag with checksums.

## Desktop acceptance — blockers

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
