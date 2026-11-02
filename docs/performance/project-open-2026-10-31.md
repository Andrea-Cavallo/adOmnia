# Project open baseline — 2026-10-31

Code Studio backend: `OpenProject` and Quick Open on synthetic repositories.
Command: `ADOMNIA_BENCH_LARGE=1 task bench:open` (`BenchmarkProjectOpen`, `internal/codestudio/open_bench_test.go`).
Machine: Windows 11, Intel i7-14700KF, NTFS, warm OS cache. 3 runs per size, averages.

Fixture: Go monorepo (`go.work`, one module every 5k files) + a `web/` package with `.ts` files (1 file in 4),
50 files per directory, plus 10% `node_modules` and 10% `vendor` noise that every walk must skip.

| Files | Metric | Before | After |
|---|---|---|---|
| 5k | open | 10.9 ms | 14.3 ms |
| 5k | open CPU (process) | 10.4 ms | 10.4 ms |
| 5k | first Quick Open | 16.0 ms | 16.1 ms |
| 50k | open | 454.6 ms | **101.3 ms** |
| 50k | open CPU (process) | 437.5 ms | 104.2 ms |
| 50k | first Quick Open | 196.2 ms | **97.5 ms** |
| 50k | warm Quick Open | 2.0 ms | 1.3 ms |
| 200k | open | 902.9 ms | **101.1 ms** |
| 200k | open CPU (process) | 869.8 ms | 109.4 ms |
| 200k | first Quick Open | 149.8 ms | 111.3 ms |
| 200k | warm Quick Open | 2.4 ms | 1.3 ms |

Indexed files are capped at `MaxQuickOpenFiles` (20,000) for 50k and 200k.

## What changed

- Unit detection left the open path: `OpenProject` waits at most 100 ms, then returns the session without units;
  the units arrive with `session.updated`, always after `session.opened`. Closing the session cancels the walk.
- Reopening an already open project no longer runs detection.
- The Quick Open index is built once per root even under concurrent queries (single-flight), is updated from
  watcher batches instead of being dropped on every create/delete, and is prepared in background 2 s after the
  watcher is ready. The "first Quick Open" column measures the cold build (no warm-up), the worst case.
- `.gitignore` is parsed once per root and reused until its mtime or size changes.
- `target` (next to `Cargo.toml`/`pom.xml`) and `obj` (next to a .NET project) are skipped by every walk.

## Reading the numbers

- "open" is bounded below by the 100 ms detection wait on large repositories: that is the time to the first
  tree, not to complete units. Small repositories return complete units well inside the wait.
- "open CPU" is the whole process during the call, background walks included.
- The first Quick Open after the cold build is still above the 80 ms target at 50k/200k; the background warm-up
  covers it when the user opens Quick Open more than ~2 s after the project.
