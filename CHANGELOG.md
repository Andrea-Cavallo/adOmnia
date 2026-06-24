# Changelog

All notable changes to adOmnia are documented here.

This project follows a pragmatic release log format inspired by Keep a Changelog. Versions are created from Git tags such as `v0.1.0`; GitHub Actions builds the Windows, Linux, and macOS artifacts automatically.

## [Unreleased]

### Added
- **GitHub host integration (Pull Requests):** connect with a Personal Access Token, list open pull requests for the origin repository, and open a PR from the current branch — without leaving adOmnia. Available in the Git "Actions" tab.
- **Multi-host Git collaboration accounts:** save multiple GitHub, GitLab, Bitbucket, and Azure DevOps identities, auto-select them from the repository remote, and protect access tokens with local Vault references. Self-hosted API base URLs are supported.
- **AI pull request drafts:** generate a reviewable PR title and Markdown description from the actual base-to-branch diff using the AI provider configured in adOmnia.
- **Repository terminal:** run shell and Git commands with the active repository as CWD, inspect output and exit status, and refresh the Git graph/status immediately after every command.

### Changed
- **Request editor hierarchy:** primary request sections now use full active tabs, body examples use selectable tab-cards with rename/duplicate/delete actions, and payload formats use a distinct segmented control with clearer labels and keyboard focus states.

## [0.4.0] - 2026-06-20

### Added
- **Git client overhaul — professional, single-repo workflow now substantially complete (34/40 GitKraken-class features):**
  - Granular staging: separate Staged/Unstaged sections, per-file and per-hunk/per-line stage/unstage, and partial commits (`CommitPaths`).
  - Full branch management: checkout of local and remote (tracking) branches, delete local/remote, and set-upstream.
  - Complete stash workflow: apply/show/drop per stash entry plus stash of selected files only.
  - Three-way conflict editor: Base/Ours/Theirs side by side with an editable merged result, saved and staged in-app.
  - Generic undo via reflog: restore to an earlier recovery point (soft/mixed/hard) beyond the last commit.
  - Visual blame and file history: per-line gutter and a navigable per-revision diff timeline.
  - AI assistance on staged changes, working changes, and branch level (commit message generation, explanation, risk scan).
  - Named Git profiles with per-host auto-switch, plus persistent repo/branch pins.
  - Advanced repository support: worktrees, submodules, and sparse checkout with UI.
  - Virtualized/lazy commit graph and extended drag & drop (branch→branch, commit→branch, file→stage).
  - Azure DevOps deep-links (commit/compare) for HTTPS, SSH `v3`, and Visual Studio hosts.
- Advanced HTTP load-test workflows in the Composer drawer: named scenarios, persisted results, baseline comparisons, and Markdown/HTML reports.
- gRPC load testing directly from gRPC Studio.
- Full bbolt snapshot export/restore and legacy localStorage migration controls in Storage Explorer.
- Active-session administration for WebSocket and SSE clients, plus configurable Proxy breakpoint patterns.
- Backend-powered RFC 6902 JSON patches and X.509 certificate inspection in Power Tools.

### Fixed
- `Push`/`Pull` no longer fall back to a hardcoded `main`/`master` when no branch is passed: the checked-out branch is resolved via `symbolic-ref`, with an explicit error on detached HEAD.
- `git status --porcelain` parsing no longer corrupts the first entry (column-0 space is preserved).

### Removed
- Orphaned Scheduler frontend bindings and the misleading RabbitMQ exchange-info endpoint, which only performed a connection check.

## [0.2.2] - 2026-06-14

### Added
- **PDF Editor** panel: view, annotate (free text, highlight, shapes, ink), fill
  AcroForm fields, place a visible signature, and export a flattened PDF. Projects
  are re-editable and persisted locally (bbolt). Open via drag-drop, file picker, or
  the "Open in PDF Editor" action on `application/pdf` API responses.
- **Cryptographic PDF signing** with `digitorus/pdfsign` (real ByteRange/CMS
  signatures), including signature verification from the toolbar.
- **Enterprise signing tier:**
  - Import **PKCS#12 (`.p12`/`.pfx`) and JKS** keystores directly in the signing
    dialog (pure-Go, no `keytool`/`openssl`); the private key is extracted in the
    backend and never reaches the frontend.
  - **Inspect certificate** before signing — shows subject, issuer, validity, and
    chain length without exposing the private key.
  - **RFC 3161 timestamping** via a configurable TSA URL (optional basic auth; URL
    can be remembered, credentials never stored).
  - **Long-term validation (LTV)** — embeds the certificate chain plus OCSP/CRL
    revocation data into the document DSS.
- Read-only **API Docs / Swagger viewer** (OpenAPI 3 and Swagger 2.0).
- GitHub Actions desktop artifact pipeline for Windows, Linux, and macOS.
- Layered hub layout for the main desktop workspace.
- Runtime support for request scripts and test/post-response execution.

### Changed
- Improved Markdown layout and Git diff workflow.
- README download instructions now point users to GitHub Releases and Actions artifacts.

### Fixed
- OpenAPI import now also accepts PDF-sourced specs.
- Linux Docker artifact export no longer creates a container from a scratch image.

### Out of scope
- PKCS#11 / HSM / smart-card signing (requires native OS drivers; conflicts with the
  single portable executable) and PAdES B-LTA archive-timestamp refresh.

## [0.1.0] - unreleased

Initial public packaging target.

### Included
- Wails 2 desktop shell with Go backend and React/TypeScript frontend.
- API workspace, environments, scripts, assertions, response viewer, and import tooling.
- SOAP, gRPC, WebSocket/SSE, brokers, mock server, proxy, browser debugging, database tools, vault, and utilities.
