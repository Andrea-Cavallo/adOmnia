# MongoDB Explorer — gap analysis and work queue

Date: 2026-11-26. Reference: the feature set of the official MongoDB GUI (query bar, CRUD, aggregations,
schema, explain, indexes, validation, import/export, export to language, shell, server stats).

## Already in adOmnia

- Database/collection tree with estimated counts, create/drop collection.
- Documents: Tree / JSON / Table views, virtualised table, resizable columns, dotted "expand nested".
- Query bar: filter, project, sort, skip, limit (shell syntax: `ObjectId()`, `ISODate()`).
- Insert (single/array), edit, clone, delete document; import JSON/NDJSON/CSV, export JSON.
- Aggregations, Schema, Indexes, Validation tabs; Explain dialog; export query/pipeline to code.
- Raw JSON runner with AI assistant, saved queries and history (SQL-style console).

## Delivered in this pass

- [x] **Narrow-pane glitch:** header, tabs, toolbar and query bar no longer stack text on top of each
      other when the documents pane is narrowed. Container queries collapse labels to icons; counters truncate.
- [x] **Live query validation:** Filter / Project / Sort turn red with the parser error as tooltip; Find is
      disabled while the query is invalid.
- [x] **Query history + favorites** per collection (popover next to the filter, star to keep, click to rerun).
      Stored in `adomnia.database.mongoQueryHistory` (localStorage, 30 recents per collection, favorites kept).
- [x] **Bulk Update / Delete** on the current filter (`updateMany` / `deleteMany`), with operator-only
      validation and a confirm that states how many documents are affected.

## Delivered in the second pass (2026-11-26)

- [x] Field / operator autocomplete in Filter, Project, Sort (reuses `jsonComplete.ts`; Tab/Enter accept, Ctrl+Space forces).
- [x] Tree view: Expand all / Collapse all, copy field path, copy value.
- [x] Inline single-field edit ($set) and remove ($unset) in the Tree view; `_id` stays read-only.
- [x] Options: Collation, Hint, Max ms (backend `mongo_query_options.go`; maxTimeMS is enforced through the context, driver v2 has no SetMaxTime).
- [x] Export CSV (dotted columns, re-importable) next to JSON.
- [x] Explain: per-stage returned / docs / keys / time from `executionStages` (SBE trees fall back to the winning plan).
- [x] Schema: top values per field with frequency bars; click adds `{ path: value }` to the filter and runs it.
- [x] Aggregations: per-stage previews and toggles already existed; toolbar and stage grid now responsive.
- [x] Performance tab: ops/s by type with sparkline, connections, network, memory, running operations with Kill.
- [x] Tree badges: view, time-series, capped (`listCollections` now returns `type` and `capped` columns).
- [x] **Fix:** read-only `runCommand`s (explain, serverStatus, currentOp, dbStats, collStats, ping…) no longer need the
      destructive-operation confirmation. Before this, Explain from the Explorer failed with "requires confirmation".
      Every other runCommand (killOp, dropDatabase, aggregate with $out…) still requires it.

## Still open

- Embedded shell (the JSON runner covers most of it).
- Collation / hint in "To code" export.
- Create views / time-series / capped collections from the tree.

## Manual checks

- [ ] Narrow the Mongo documents pane to ~420 px: header, tabs, toolbar and query bar stay on one line, nothing overlaps.
- [ ] Type `{ a: ` in Filter: red border, Find disabled; fix it and Find runs.
- [ ] Run two queries, open History, rerun one, star it, reload the app: favorite still there.
- [ ] Update with `{ $set: { flag: true } }` on a filter: confirm shows the count, notice shows matched/modified.
- [ ] Delete on a filter: confirm, count in the tree decreases, list refreshes.
- [ ] Type `{ na` in Filter: suggestion list with field names; Tab inserts `name: `. `{ age: { $g` suggests `$gt`, `$gte`.
- [ ] Tree view: hover a field, edit its value inline, Enter saves; Remove field asks for confirmation.
- [ ] Options → Collation `{ locale: 'it', strength: 2 }` makes a case-insensitive match work; Max ms `1` on a big collection times out.
- [ ] Explain on an indexed filter: tree shows IXSCAN with keys examined; no confirmation prompt.
- [ ] Schema → Analyze, click a top value: Documents tab opens filtered on it.
- [ ] Performance tab: numbers update every 2 s, Pause stops polling, Kill on a long op asks and kills it.
- [ ] A view and a capped collection show their badge in the tree.
