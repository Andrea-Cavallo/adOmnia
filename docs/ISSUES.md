# adOmnia - Open Issues & Missing Features
*Perspective: a developer who uses adOmnia daily as their primary API tool.*
*Last reviewed: 2026-06-13*

This file contains only work that is still open. Completed items are archived in the "Recently Resolved" section below.

## Priority Guide

| Priority | Meaning |
|----------|---------|
| P0 - Blocker | Stops a core workflow. |
| P1 - High | Significant daily friction. |
| P2 - Medium | Quality gap with a workaround. |
| P3 - Polish | Product still feels unfinished. |

## Open Queue

_No verified-open issues. The previously-listed backlog items were re-checked against
the current codebase on 2026-06-13 and found already resolved (see below)._

## Recently Resolved (verified against code 2026-06-13)

| # | Title | Evidence |
|---|-------|----------|
| P2-09 | GraphQL schema/variables not persisted | `useGraphqlCacheStore` persists introspection; `BodyEditor.tsx` hydrates the cache on mount and re-uses the stored schema. |
| P2-11 | Keyboard shortcuts incomplete | `SettingsPanel.tsx shortcutsList` now documents 14 shortcuts (command palette, send, tab nav, url bar, search, sidebar, settings, rail switch, dev logs), up from 5. |
| P3-08 | Vault ↔ Environment bridge missing | `lib/vaultRefs.ts` resolves `vault:` references; wired into the send path (`sendRequest.ts`) and the environment editor (`EnvModal.tsx` detects/marks `vault:` refs). |
| N03 | Win95 JSON bracket depth colors collapsed | `internal/themes/extended.go` json-bracket-1/2/3 are distinct (`#000080`/`#8B0000`/`#006464`), not all `#000000`. |

## New This Cycle

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
Reference: `docs/LOG-INSPECTOR.md`.

Verification: 73 dedicated tests, 354 frontend tests across 72 files, TypeScript and
production frontend build, `go build`/`go vet`/`go test ./...`.

Pending:

| Priority | Item |
|---|---|
| P2 | `oc logs` execution — the `OC_LOGS_SOURCE` seam exists with `available: false`; the Go binding that runs `oc logs -f` is missing. |
| P2 | Live tailing — the parser is already incremental (`createLogParser`), it needs a stream-fed entry point. |
| P2 | No tests cover the worker `parse`/`progress`/`cancel` protocol; the pure parser and the main-thread fallback are covered. |
| P3 | `raw` keeps a per-event copy of the source line, the dominant memory cost at 100k events; an offset into the original text would remove it. |
| P3 | `.gz` / `.zip` inputs must be extracted manually before import. |

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
