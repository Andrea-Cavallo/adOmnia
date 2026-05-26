# adOmnia - Open Issues & Missing Features
*Perspective: a developer who uses adOmnia daily as their primary API tool.*
*Last reviewed: 2026-05-26*

This file contains only work that is still open. Completed items are archived in [`HISTORY_ISSUES.md`](./HISTORY_ISSUES.md).

## Priority Guide

| Priority | Meaning |
|----------|---------|
| P0 - Blocker | Stops a core workflow. |
| P1 - High | Significant daily friction. |
| P2 - Medium | Quality gap with a workaround. |
| P3 - Polish | Product still feels unfinished. |

## P1 - High Priority

## P2 - Medium Priority

### P2-09 - GraphQL has no persisted query variables or schema cache

**User story:**
> I run schema introspection for a large GraphQL API. I close the tab and reopen it; the schema is gone, so I have to fetch it again every session.

### P2-11 - Keyboard shortcuts are incomplete and not consistently discoverable

**User story:**
> I look at Settings -> Keyboard Shortcuts to learn what is available. I see only a few shortcuts, while most panels and frequent actions are absent.

**What's broken:**
`G2.10` documents only five keyboard shortcuts. `docs/SOUL.md` states that actions should be keyboard-accessible, but the product does not yet meet that expectation.

## P3 - Polish

### P3-08 - Vault and Environment variables have no bridge

**User story:**
> I store `PROD_DB_PASSWORD` in the Vault. I want to reference it through `{{PROD_DB_PASSWORD}}` in requests, but there is no way to link the Vault secret into an environment variable.

**What's missing:**
Vault and environment substitution exist independently, but the Vault-to-Environment workflow is not wired into the UI.

## New Audit Issues

### N03 - JSON bracket nesting colors lost in Win95 theme

**File:** `themes_extended.go:1004-1006`

**What's broken:**
`json-bracket-1`, `json-bracket-2`, and `json-bracket-3` all render as `#000000`. Bracket depth levels no longer have distinct visual nesting colors in deeply nested JSON.

## Open Summary

| # | Title | Priority | Area |
|---|-------|----------|------|
| P2-09 | GraphQL schema and variables are not persisted | P2 | GraphQL |
| P2-11 | Keyboard shortcuts incomplete | P2 | UX |
| P3-08 | Vault to Environment bridge missing | P3 | Integration |
| N03 | Win95 JSON bracket depth colors collapsed | P3 | Visual |

## Suggested Fix Order

1. `P3-08` - Vault to Environment variable bridge.
2. `P2-09` - GraphQL persistence and schema caching.
3. `P2-11` - Shortcut coverage and discoverability.
4. `N03` - Visual clarity (Win95 bracket depth colors).
