# Changelog

All notable changes to adOmnia are documented here.

This project follows a pragmatic release log format inspired by Keep a Changelog. Versions are created from Git tags such as `v0.1.0`; GitHub Actions builds the Windows, Linux, and macOS artifacts automatically.

## [Unreleased]

### Added
- **Versionable collection folders:** collections can now be exported as deterministic, diff-friendly folders with stable metadata, folder/request JSON files, Windows-safe names, and a sync manifest. The importer reconstructs the collection tree from disk and round-trips the exported structure deterministically.
- **Collection folder workflow in Git Sync:** the Git Sync panel includes a `Collection Folder` section for exporting the selected collection, importing a folder-backed collection, and checking drift between the in-app collection and the folder projection.
- **Headless collection runner foundation:** the desktop executable now supports `adomnia run <collection-folder>` without opening the Wails UI. The runner imports folder-backed collections, executes supported HTTP requests through the Go transport, supports CLI/JSON reports, `--out`, `--bail`, `--env`, and `--env-var KEY=VALUE`.
- **CI-ready runner output:** the headless runner now supports `--folder` for focused folder runs and `--reporter junit` for pipeline-readable XML reports.
- **Shared request execution contract:** GUI and headless execution now share a stable request-resolution layer for variables, path params, query/header/body resolution, simple auth, and assertion evaluation.

### Changed
- **Request sending now records a resolved request contract before transport:** the existing GUI send path still calls the same backend transport, but the resolved request shape is now explicit and covered by tests.

### Notes
- The headless runner intentionally reports unsupported areas instead of pretending parity: OAuth browser flows, AWS signing, Vault-backed secrets, full cookie jar sharing, and advanced multipart upload support remain future parity work.

## [0.4.8] - 2026-06-25

### Added
- **Save a response value as an environment variable:** right-click any value in the response Body (or a Headers value) and choose *Save as environment variable…* — pick the name (the JSON key is suggested automatically) and the target environment. Perfect for capturing a token from a getToken-style response straight into `{{access_token}}`. A *Copy value* action is included in the same menu.

### Changed
- **System titlebar is now the real default:** existing installs that still carried the legacy in-app titlebar are migrated to the native system titlebar on launch (explicit choices are preserved). New installs already defaulted to it.

### Fixed
- **Welcome hub search hint readability:** the "Press Ctrl/Cmd + F to search any feature" badge was nearly invisible on the light theme — it now uses theme-aware contrast.
- **PSD2 / Berlin Group header presets visibility:** the quick-add presets area is taller so the Berlin Group section is no longer hidden below the Common headers.

## [0.4.7] - 2026-06-25

### Added
- **PSD2 / Berlin Group header presets:** the request Headers tab now offers the NextGenPSD2 (XS2A) standard headers — `Consent-ID`, `PSU-ID`, `PSU-IP-Address`, `TPP-Redirect-URI`, `Digest`, `Signature`, `TPP-Signature-Certificate`, `Aspsp-Sca-Approach`, and more — as one-click chips, grouped separately from the common headers.

### Changed
- **Environments & Hosts moved into the sidebar (more vertical room):** the Env and Hosts switchers no longer sit in a strip above the request — they live in the left sidebar under the Workspace selector, right above Collections. Switching, adding, renaming, and editing environments/hosts all happen from there. The request method + URL bar now sits higher, giving the Body/Response area more space.
- **Workspace name in the panel header:** the API Workspace header shows the active workspace name (live — rename it in the sidebar and the header updates) instead of a static "API Workspace" label.
- **Clearer header presets and labels:** preset chips that share a value (e.g. `application/json` for both Accept and Content-Type) now show the full `Header: value` so they are no longer ambiguous duplicates, and the Headers tab columns read **Header name / Header value** for consistency with the Cookies tab.

### Added
- **GitHub host integration (Pull Requests):** connect with a Personal Access Token, list open pull requests for the origin repository, and open a PR from the current branch — without leaving adOmnia. Available in the Git "Actions" tab.
- **Multi-host Git collaboration accounts:** save multiple GitHub, GitLab, Bitbucket, and Azure DevOps identities, auto-select them from the repository remote, and protect access tokens with local Vault references. Self-hosted API base URLs are supported.
- **AI pull request drafts:** generate a reviewable PR title and Markdown description from the actual base-to-branch diff using the AI provider configured in adOmnia.
- **Repository terminal:** run shell and Git commands with the active repository as CWD, inspect output and exit status, and refresh the Git graph/status immediately after every command.

### Changed
- **Request editor hierarchy:** primary request sections now use full active tabs, body examples use selectable tab-cards with rename/duplicate/delete actions, and payload formats use a distinct segmented control with clearer labels and keyboard focus states.

## [0.4.6] - 2026-06-25

### Added
- **Cancel in-flight requests:** while a request is running the **Send** button turns into a red **Cancel** button, so a slow or hung request can be aborted immediately. Cancellation is wired end-to-end — the Go backend registers each request by id and aborts the underlying connection (both the native HTTP path and the browser-fetch upload path). Cancelled requests report a clean `CANCELED` status instead of a misleading error.
- **Close All tabs:** new **Close All** action in the tab context menu, alongside Close / Close to the Right / Close to the Left. Honors the unsaved-changes confirmation dialog.
- **Create an environment straight from the URL bar:** right-clicking an `{{variable}}` token in the URL when no environment exists now creates one on the spot and opens the inline value editor, so the variable can be given a value without leaving the request.

### Changed
- **Collapsible API Tools bar (cleaner, more minimal layout):** the API Tools row (Follow redirects, Load test, Timeout, URL Encode, Query String, Import cURL, HTTP Status) is now hidden by default and toggled with a small control next to **Send**. Collapsing it gives the Body/Response area more vertical room; the open/closed state is remembered between sessions.

### Removed
- **Settings → Features section:** removed the non-functional "Plugins (experimental)" and "Daily Scenarios (experimental)" toggles and their navigation entry.

### Notes
- adOmnia has request timeouts: a per-request **Timeout (ms)** field (`0` = no timeout) plus a global default in **Settings → Requests**. Requests exceeding the timeout fail with a `TIMEOUT` status — the same model used by Postman/Bruno.

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
