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

### Python Code Studio — 2026-10-21

Initial adapter implemented: project-marker/loose-script detection and schema-driven script/module Run with explicit interpreter. Automated adapter, mixed-workspace, trust and host-routing checks pass, including real script/module execution with local Python 3.11. Native desktop PY-M1/PY-M3 remains open. TOML parsing, per-unit interpreter discovery, LSP, pytest and debugpy remain in `mds/MULTILANGUAGE-IDE.md` §9.5; Python support is not complete. Rust has no adapter yet.

### Run configuration interface — 2026-10-21

Implemented project-aware creation, saved/type search, unit grouping, explicit review of detected entries, unambiguous unit cwd defaults, compact parameter sections and draft-discard protection. Focused frontend tests and build pass; browser fixture inspected in light/dark. Real Wails save/detection/native acceptance remains open as RC-UI.M1 in `mds/MANUAL-CHECK.md`.

### Editor keyboard mode — 2026-10-21

Reproduced the reported Enter/Space cursor-only behavior with real Monaco + monaco-vim in Normal mode. The mode indicator had been hidden; mode-change tracking incorrectly listened for DOM events instead of adapter events. Restored a visible mode hint and standard-editing recovery action; fixed adapter subscription/disposal. Regression test failed before fix and passes after it. Browser fixture verifies i → insert and recovery → ordinary letters/spaces/newlines. Actual user session configuration not inspected; native Wails acceptance remains EDIT-MODE.M1.
