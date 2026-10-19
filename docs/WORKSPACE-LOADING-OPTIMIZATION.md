# Workspace loading optimization

Implementation checkpoint: 2026-10-19. No native timing measurements yet.

## API workspace

- [x] A1: bootstrap first uses a read transaction. A valid legacy snapshot requests a write transaction only when migration needs to persist shards. The entire bootstrap is re-read in that transaction to preserve a consistent snapshot. A regression test verifies that subsequent bootstraps do not advance the database transaction ID.
- [x] A2: validate workspace JSON in the workspace decoder, check the already validated collections value's array type without decoding every collection again, encode index metadata separately and append the raw collection bytes. The V2 bootstrap trusts this validated active payload instead of calling `json.Valid` again.
- [ ] A3: separate tree metadata from request contents. Requires a compatible shard migration and frontend request hydration, including export and save paths.
- [ ] A4: remove or defer rebuilding the legacy snapshot. The complete v2 downgrade snapshot is still maintained.
- [ ] A5: idle/hover prefetch and a structured workspace IPC response.

## Code Studio

- [x] B1: restored sessions start watching on their first `GetSessionView`, rather than all projects being scanned at restore. New projects retain their existing watcher startup. Directory scans and gitignore loading run outside the manager lock; Stop cancels an in-progress walk and Shutdown prevents late registrations.
- [x] B3, parallel restoration: directory, runs, view/recovery and Run configuration loading overlap. Saved tabs load concurrently, retaining their saved order and explicit session ID even if the user switches projects during restoration. A failed view restore can be retried.
- [ ] B3, active tab only: deferred. Current document tabs require loaded editor documents; placeholders and split-view restoration need a separate implementation.
- [ ] B2: shared project detection walk.
- [ ] B4: per-session persistence and bounded recent-project filesystem checks.
- [x] B5, initial frontend instrumentation: first-session request, first directory response and restored tabs use the existing local startup recorder. `getStartupDurations()` exposes `studioFirstTreeMs` and `studioTabsRestoredMs`. Marks describe the first session only; the tree mark measures receipt of data, not a rendered frame.
- [ ] B5, remaining instrumentation: backend restore, detect-units, watcher-ready and language-server readiness; repeated session-switch measurements.

## Compatibility and acceptance

No persistence format, exported workspace format, or public binding signature changes. Legacy collection snapshots remain available for downgrade. Diagnostics remain local.

- Automated: bootstrap/collectionsstore tests; focused watcher/session tests; frontend restoration and startup recorder tests; TypeScript and frontend production build; startup bundle budget.
- Verified checkpoint: 16 frontend tests passed; bootstrap/collectionsstore tests and focused watcher/session tests passed; frontend build and `go build ./...` passed. Startup JavaScript: 636,556 / 650,000 bytes, with no deferred modules in the initial graph.
- [ ] Complete Code Studio package suite: an additional run was interrupted after more than six minutes without a package result. It is not recorded as passed or as a test failure. The focused watcher/session run completed successfully after the final watcher changes.
- [ ] Native Wails acceptance: cold/warm API startup, first switch to an inactive API workspace, Studio restore and repeated switching with multiple tabs/splits, recovered buffers, and filesystem changes after selecting a restored project.
- [ ] Native timing comparison on the same data, including large bodies and inactive projects. No speedup percentage is claimed from code inspection or automated builds.
