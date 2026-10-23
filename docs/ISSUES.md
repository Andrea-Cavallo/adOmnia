# adOmnia - Open Issues & Missing Features
*Perspective: a developer who uses adOmnia daily as their primary API tool.*
*Release queue updated: 2026-10-15; historical audit below: 2026-06-13.*

This file contains only work that is still open. Completed items are archived in the "Recently Resolved" section below.

## Priority Guide

| Priority | Meaning |
|----------|---------|
| P0 - Blocker | Stops a core workflow. |
| P1 - High | Significant daily friction. |
| P2 - Medium | Quality gap with a workaround. |
| P3 - Polish | Product still feels unfinished. |

## Open Queue

The active stabilization queue is [FIX.md](../mds/FIX.md), with [post-1.0.2 release targets](ROADMAP-FIXES.md). DB-2 implementation is included in 1.0.2; the complete remote-driver desktop matrix and independent review remain open. The historical audit below does not supersede this queue.

## Recently Resolved (verified against code 2026-06-13)

| # | Title | Evidence |
|---|-------|----------|
| P2-09 | GraphQL schema/variables not persisted | `useGraphqlCacheStore` persists introspection; `BodyEditor.tsx` hydrates the cache on mount and re-uses the stored schema. |
| P2-11 | Keyboard shortcuts incomplete | `SettingsPanel.tsx shortcutsList` now documents 14 shortcuts (command palette, send, tab nav, url bar, search, sidebar, settings, rail switch, dev logs), up from 5. |
| P3-08 | Vault ↔ Environment bridge missing | `lib/vaultRefs.ts` resolves `vault:` references; wired into the send path (`sendRequest.ts`) and the environment editor (`EnvModal.tsx` detects/marks `vault:` refs). |
| N03 | Win95 JSON bracket depth colors collapsed | `internal/themes/extended.go` json-bracket-1/2/3 are distinct (`#000080`/`#8B0000`/`#006464`), not all `#000000`. |

## New This Cycle

### Live Development Session — implemented, manual verification open

Backend, correlation and the Delve loop are covered end to end by `internal/codestudio/devsession_integration_test.go` (real Go service under real Delve; skipped without `dlv`). Details: [LIVE-SESSION.md](LIVE-SESSION.md).

- [ ] **P1 — Manual checks in the running app**: debug bar in every tool, Debug Request from a stopped service, Split Debug View, Ctrl+Tab, Alt+Shift+1…5, SQL capture with a real Postgres/MySQL, Kafka watch with a real broker, both themes and a small window.

### Java / JVM studio — real multimodule verification (2026-10-20)

Verified on `quarkus-super-heroes-main` (10-module Quarkus reactor, Java 25): full compile, tests with Docker Dev Services (75 executed; the 6 failures are the JVM locale only — Hibernate Validator messages in Italian against English expectations), and Eclipse JDT LS importing all 9 modules with the right toolchain. Fixed for projects this size: Run console line alignment (`\r` redraws and chunk-split lines), coalesced process output so the UI stays responsive during `mvn test`, Java toolchain read from the reactor modules, and JDT LS auto-start on Java projects. Manual checks in [MANUAL-CHECK.md](../mds/MANUAL-CHECK.md) (`JS-17.M1`–`M4`), plan in [06-JAVA-SPRING-STUDIO.md](../mds/06-JAVA-SPRING-STUDIO.md) (JS-14, JS-17).

### Spring datasource → Database Studio (2026-10-22) — implemented, desktop check open

*Tools → Project Services* now reads `spring.datasource.*` from `application.properties`/`.yml` and their profiles and opens Database Studio with the known target (host, port, database, user, SSL mode). The profile and `file:line` are shown, placeholders stay unresolved and are named as missing, and unsupported vendors are listed with the reason. Passwords are never read or copied — only their presence — and the connection is created without credentials, sealed by the Vault once the user enters them. No connection or process starts on project open. Implementation and automated tests are in the plan (`JS-15`); the desktop check is `JS-15.M1`.

### Code Studio (IDE) — shipped through v0.9.39, manual verification open

Implemented and covered by automated tests on Windows and Linux: projects and trust, isolated sessions and restore, gopls intelligence and refactoring, linters, Fix with AI, build/run/tests/coverage, the Delve debugger, the PTY terminal, Go Tools, Git in the editor linked to Git Studio, adOmnia integrations, Code Studio workspaces and separate project windows. Details: [CODE-STUDIO.md](CODE-STUDIO.md). The work queue lives in `mds/todo-ide.md`.

Copilot ghost text and the per-project Ask chat are implemented. The chat streams answers, supports Stop/New Chat and filters file, selection and workspace-manifest context through the same secret and `.adomnia/aiignore` boundary. Automated coverage is present; the real-account UI check remains open.

Open:

- LSP incremental synchronization and superseded read cancellation are implemented
  and tested with local gopls v0.23.0; desktop editing/multi-window acceptance is
  pending (REF-2.M1 in `mds/MANUAL-CHECK.md`). Root-only process sharing was
  evaluated and not enabled because sessions own independent unsaved overlays.

- [ ] **P1 — Manual checks in the running app** (M1–M31 in `mds/todo-ide.md`): real-project flows on Windows, Task Manager clean-up, ConPTY in the window, debugger from the UI, themes, and the quality bar compared with the approved mocks.
- [ ] **P2 — Separate windows not declared yet**: implemented and tested automatically; to be declared in the release notes after the real-window check (M31).
- [ ] **P1 — Docker Build & Run by hand** (v0.9.39): with Docker Desktop running, Build image, Build & Run and Stop on a real Dockerfile (container removed, `docker ps` clean). The automated test skips without a daemon; Make is already covered end to end.
- [ ] **P3 — macOS runtime not verified**: the package cross-builds, but nothing has run on macOS.

Residual limits (by design, stated in the product):

- Push, pull, merge, conflicts, branches, stash and pull requests are in the IDE Git tool window; rebase and drag-and-drop cherry-pick stay hidden in V1; other version control systems are not supported.
- Plugins get read-only events (contract v1) and no commands.
- The API Client CodeLens resolves route prefixes only within the same file.
- Remote debugging needs identical source paths for breakpoints.
- Refactorings are limited to the code actions gopls offers.
- Fix with AI needs an AI provider enabled and verified in Settings, and sends the affected code only when the user clicks.


### Developer Context P0+P1 — implemented (branch `feat/devcontext`, 2026-09-29)

- [x] Entity router (`frontend/src/lib/entities/`), panel handoff, notice bar
- [x] Project context backend (`internal/devcontext`): go.mod, compose, .env (masked), OAS/proto/WSDL, Go routes, getenv/SQL/topics
- [x] Palette groups Project + Symbols, Tab actions
- [ ] Manual smoke in `wails3 task dev` on a real Go project (see plan Task 13 Step 5)
- Next: P2 gO code lenses + env resolver.

### Log Inspector — shipped (v0.9.0, promoted to a rail destination in v0.9.1)

Local-first log investigation studio: paste / drop / open OpenShift and application
logs (single JSON, JSON array, JSONL/NDJSON, plain and mixed text, CRI-O prefixes,
ANSI, Java exceptions, Go panics, escaped nested JSON). Format is detected from the
content, never from the extension; a malformed line is marked `RAW` without stopping
the import. Virtualized event list, field-query language (`level:error pod:pay-*
-service:noisy`), facets, time range, correlation-ID/trace-ID chronological
reconstruction with deltas, sensitive-field masking, and JSON/JSONL/text export.
Parsing runs in a Web Worker with progressive batches, cancellation and a configurable
50k–500k retention ceiling. Files: `lib/loginspector/*`, `components/loginspector/*`.
Verification: 73 dedicated tests, 354 frontend tests across 72 files, TypeScript and
production frontend build, `go build`/`go vet`/`go test ./...`.

Pending:

| Priority | Item |
|---|---|
| — | ~~`oc logs` execution~~ — done: `internal/logstream` tails local files and runs `kubectl`/`oc`/`docker logs -f` through the sidecar, with explicit context/namespace/pod/container, bounded buffer, stop/resume without duplicates, and CLI availability reported up front. |
| P2 | Live tailing — the parser is already incremental (`createLogParser`), it needs a stream-fed entry point. |
| P2 | No tests cover the worker `parse`/`progress`/`cancel` protocol; the pure parser and the main-thread fallback are covered. |
| P3 | `raw` keeps a per-event copy of the source line, the dominant memory cost at 100k events; an offset into the original text would remove it. |
| P3 | `.gz` / `.zip` inputs must be extracted manually before import. |

### Flows — scoped variables and stress test (2026-09-11)

Fixed: a `{{var}}` pasted into a step body was flagged unresolved (red) although the
runner resolved it, because request editors only looked at the active environment.
Editors inside a flow step now also see variables extracted by other steps and the last
run's values (`lib/flowScopeVars.ts`).

New: flow **Stress test** dock (`lib/flowStress.ts`, `lib/flowStressStats.ts`,
`lib/flowStressExport.ts`, `components/flows/FlowStressPanel.tsx`). Up to 200 local
virtual users, iterations/duration or editable stages, CSV/JSON/JUnit/HTML exports,
APDEX, active-user/distribution/trend charts, persisted history and baseline
comparison. Portable plans run headlessly through `adomnia stress` with CI exit
codes and dataset/environment injection.

Desktop verification (production executable driven over CDP): Mock Commerce demo,
10 VU × 30 s with 2 s ramp-up — 3385 requests, 112.8 req/s, 0 errors, 843 iterations,
live KPIs and per-step table; baseline Δ p95 and throughput change; light and dark
themes; right-click Edit / Copy value / Copy reference on body and URL variables.

| Priority | Item |
|---|---|
| P3 | Export files were not opened from the native save dialog during the desktop pass; builders are covered by unit tests. |
| P3 | Scoped variables ignore graph order: a step also sees variables produced by later steps. |
| P3 | Multi-machine distributed load still needs an authenticated worker protocol; the desktop and headless engines intentionally remain local generators. |

### Flows — recording and demo usability (2026-09-08)

Fixed `unknown storage bucket "flows"` on recording/save. Recordings infer exact,
unambiguous JSON response-to-request mappings, including bearer tokens and typed JSON
bodies, and retain mappings through save/load. Runtime transport errors appear in the
timeline; Stop on failure prevents later linear steps from running. The canvas now has
contrasting arrows, branch-preserving arrangement, pan/zoom/fit controls and adjustable
panels. Saved graph positions are retained when the flow is reopened.

September 9 usability update: compact flow switcher and node rows, cursor-anchored
zoom, frame-scheduled free dragging (Shift snaps), and independent panel visibility.
Inspector, timeline, Mermaid import and AI panels share float/dock, resize, maximize
and close controls. Closing the inspector preserves selection; execution highlights
do not reopen closed panels. The focus toggle temporarily hides panels.
Desktop verification also covered panel close/reopen, floating drag, corner resize
and workspace maximization in the production executable.

Verification: 30 targeted frontend tests, TypeScript and production frontend build,
`go build ./...` and `go test ./...`. Desktop checks completed: four-API mock demo,
REC login → order with the inferred `user.id` mapping, save/open, and successful replay
(HTTP 200/201). The development CLI was run from `build/` because `root_path: ..`
in `build/config.yml` resolves against its working directory.

### PDF Editor — shipped (branch `feat/pdf-editor`)
View + edit PDFs (free text, highlight, shapes, ink, AcroForm fill, visible signature),
re-editable project persistence (bbolt `pdfprojects`), flattened export. Pending: manual
`wails3 task dev` smoke of the full open→annotate→export→reopen loop. Spec:
`docs/superpowers/specs/2026-06-13-pdf-editor-design.md`.

### API Docs / Swagger viewer — shipped (branch `feat/pdf-editor`)
Dedicated read-only OpenAPI 3 / Swagger 2.0 reference (rail: API Core → Design),
token-native (no external Swagger-UI/Redoc framework). Sources: generate from a
collection, fetch from URL via the Go request engine, or paste/open a JSON/YAML file.
Grouped by tag with params, request/response schemas (recursive `$ref` resolution),
examples, and an operation filter. v1 is read-only ("Try it" deferred). Files:
`lib/apidocs/parseSpec.ts`, `components/apidocs/*`. Pending: manual `wails3 task dev` smoke.


### Resource diagnostics — 2026-10-19

Implemented: live persistent backend GC limit, selectable gopls limit with project restart, timed CPU/RSS recording, per-process charts and parent/owner provenance, JSON/CSV/MD/HTML export. The reported 50% CPU spike did not reproduce in the 32-second baseline; no root cause is claimed. Evidence and limits: [report](performance/resources-2026-10-19.md). Native acceptance remains RES-1.M1–M3 in mds/MANUAL-CHECK.md.

### Python Code Studio - 2026-10-21

Python is now a first-class Code Studio language: static unit detection with TOML parsing, per-unit interpreter resolution and selection (`.adomnia/python.local.json`), script/module Run, structured pytest in the Test tree (adOmnia pytest plugin with real node IDs) with optional coverage, debugpy debugging (script/module/pytest, exception breakpoints, explicit local attach, shared debug panels), Ruff formatting as an explicit optional tool, and basedpyright editing assistance (pinned, explicitly installed, one language server per unit so two units with different virtualenvs never share an interpreter). HTTP routes from FastAPI, Flask and Django reach the Developer Context and open in the API client like Go and Spring routes, Project Services preselects Database Studio/Broker Studio/Docker Lab from `pyproject.toml`/`requirements*.txt`, and Security Center scans Python manifests through a new PyPI ecosystem adapter (poetry/uv lockfiles give the resolved versions), with editor lenses/markers/quick fixes on pinned requirements, a Python tab in Module dependencies and an API Docs handoff of the detected local server URL. Downloaded tool artifacts are verified: pip reports the SHA-256 of every artifact and adOmnia refuses a tools folder that does not match the manifest it recorded. Automated checks pass, including real pytest and real debugpy integration runs against a local Python 3.11 with pytest 9.1.1/debugpy 1.8.22. Open: native desktop acceptance (PY-M* in `mds/MANUAL-CHECK.md`), the macOS/Linux matrix, manual editor checks on unsaved buffers/UTF-16/stub files, an async pytest case, and startup/idle/RAM measurements (see `mds/MULTILANGUAGE-IDE.md` §9.5). Rust is no longer pending an adapter: `internal/languages/rust` is delivered, see below.

### Rust Code Studio - in preparation (2026-10-23)

Rust is implemented like the other Code Studio languages and is **not announced as supported yet**: the manual app checks are open. Static Cargo detection (packages, virtual workspaces, `target/` excluded, `build.rs` and proc-macros never executed), per-project toolchain from `rust-toolchain.toml`/saved choice/PATH with explicit `rustup` install actions, `bin`/`example`/`bench`/`build`/`check`/`clippy` runs with features, profile and target, build diagnostics in Problems with clickable `file:line:col`, `cargo test` as a structured Test tree (integration tests, doctest, panic locations, rerun failed), rust-analyzer per Cargo unit with `rustfmt` on save, CodeLLDB debug (pinned, SHA-256 verified) with a `rust_panic` breakpoint, dependency tree from `Cargo.lock` and a crates.io/OSV adapter in the Security Center. The detectors bring axum/actix/rocket routes, `utoipa` contracts, sqlx/diesel/sea-orm databases, tonic gRPC, WebSocket/SSE, broker topics, env vars and Cargo modules to API Workspace, Mock, Database and Live Session. Automated tests pass, including real cargo and rust-analyzer runs (ADOMNIA_TEST_CARGO). Open: the desktop acceptance RS-M1…RS-M10 in `mds/MANUAL-CHECK.md` (RS-M7 is the integration gate; the fixtures and a pre-check for RS-M1 are ready), test debugging and coverage (RS-5.5/RS-5.6), CodeLLDB attach and a real DAP test (RS-6.5/RS-6.6), the generic `toolmanifest` installer (RS-9.4) and the RAM measurements (RS-9.5) — see `mds/MULTILANGUAGE-IDE.md` §9.6.

### Run configuration interface — 2026-10-21

Implemented project-aware creation, saved/type search, unit grouping, explicit review of detected entries, unambiguous unit cwd defaults, compact parameter sections and draft-discard protection. Focused frontend tests and build pass; browser fixture inspected in light/dark. Real Wails save/detection/native acceptance remains open as RC-UI.M1 in `mds/MANUAL-CHECK.md`.

### Editor keyboard mode — 2026-10-21

Reproduced the reported Enter/Space cursor-only behavior with real Monaco + monaco-vim in Normal mode. The mode indicator had been hidden; mode-change tracking incorrectly listened for DOM events instead of adapter events. Restored a visible mode hint and standard-editing recovery action; fixed adapter subscription/disposal. Regression test failed before fix and passes after it. Browser fixture verifies i → insert and recovery → ordinary letters/spaces/newlines. Actual user session configuration not inspected; native Wails acceptance remains EDIT-MODE.M1.

### AI-CHAT — Claude/milk parity and milk 0.7 adaptation (2026-10-21)

Implemented shared live-project context with independent selection and language-unit metadata; advertised session model selectors (modern/legacy ACP); explicit external UTF-8 files and capability-gated image payloads with backend MIME/size validation. Failed sends retain drafts/attachments. Milk 0.7 configured-primary selector changes its global config with backup and starts a new project chat; reasoning/routing options and task plans use their actual v2 shapes. Fresh-session metadata prevents invisible automatic conversation adoption. Project AI policy is enforced before session controls or prompts. Tests cover transport/state/policy/config isolation; native provider acceptance remains AI-CHAT.M1–M4.

Installed milk remains 0.5.4; upstream stable 0.7.0 was inspected, not installed automatically. **2026-10-22:** images are no longer rejected — when the agent does not advertise native ACP image blocks (milk 0.7–0.9), adOmnia writes the image to a private temp folder and prefixes the turn with `@<absolute path>`, milk's own CLI convention, deleting the file when the turn ends. `available_commands_update` is consumed into a composer palette for the agent's real commands (`/workflow`, `/bg`, `/tasks`, `/usage`, `/memory`, `/escalate`, …), and background-agent follow-up turns (started by milk with no prompt) are shown as an assistant turn marked *background*. Arbitrary model changes inside a live milk ACP session, complete history replay, interactive workflow boards and team workflow boards are not implemented. See `mds/MULTILANGUAGE-IDE.md` AI-CHAT and AG.
