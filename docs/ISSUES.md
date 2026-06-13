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

## Queued (needs brainstorm before implementation)

### API Docs / Swagger viewer
A dedicated read-only Swagger-UI / Redoc-style reference surface (own rail entry),
generating specs from collections (`lib/openapi.ts` / `lib/swagger2.ts`) and loading
from a running server URL. Open design decisions remain ("Try it" wiring, renderer
approach), so this needs its own brainstorm + spec before implementation.

## Recently Resolved (verified against code 2026-06-13)

| # | Title | Evidence |
|---|-------|----------|
| P2-09 | GraphQL schema/variables not persisted | `useGraphqlCacheStore` persists introspection; `BodyEditor.tsx` hydrates the cache on mount and re-uses the stored schema. |
| P2-11 | Keyboard shortcuts incomplete | `SettingsPanel.tsx shortcutsList` now documents 14 shortcuts (command palette, send, tab nav, url bar, search, sidebar, settings, rail switch, dev logs), up from 5. |
| P3-08 | Vault ↔ Environment bridge missing | `lib/vaultRefs.ts` resolves `vault:` references; wired into the send path (`sendRequest.ts`) and the environment editor (`EnvModal.tsx` detects/marks `vault:` refs). |
| N03 | Win95 JSON bracket depth colors collapsed | `internal/themes/extended.go` json-bracket-1/2/3 are distinct (`#000080`/`#8B0000`/`#006464`), not all `#000000`. |

## New This Cycle

### PDF Editor — shipped (branch `feat/pdf-editor`)
View + edit PDFs (free text, highlight, shapes, ink, AcroForm fill, visible signature),
re-editable project persistence (bbolt `pdfprojects`), flattened export. Pending: manual
`wails dev` smoke of the full open→annotate→export→reopen loop. Spec:
`docs/superpowers/specs/2026-06-13-pdf-editor-design.md`.
