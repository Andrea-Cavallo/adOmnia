# gopls with 1, 3 and 5 Go projects — 2026-10-25

PERF-3.1 (Go part) and the data for the PERF-3.4 decision: how gopls memory grows with the number
of open Go projects, with one gopls per project (what adOmnia does today) versus one shared gopls
daemon serving every project.

| | |
| --- | --- |
| Host | Windows 11 Pro 26300 · i7-14700KF (28 logical CPUs) · 63.8 GB RAM |
| gopls | v0.24.0, the copy adOmnia installs · `GOMEMLIMIT=768MiB` · `GOTOOLCHAIN=local` (same environment as the app) |
| Projects | adOmnia (1,289 `.go` files) · ado-e2e (961) · adomnia-devsession (377) · fans-backend (141) · openfinance (23), added in this order |
| Separate | one `gopls` process per project over stdio |
| Shared | one `gopls serve -listen=127.0.0.1:<port>` daemon + one `gopls -remote=<port>` forwarder per project |
| Per run | LSP `initialize` → wait for "Setting up workspace" to end on every project → `didOpen` one source file per project → 30 s settle → 5 samples 2 s apart, median |
| Runs | 3 per configuration (18 runs, 0 timeouts) |
| Script | [`scripts/measure-gopls-multi.mjs`](../../scripts/measure-gopls-multi.mjs) · raw results: [gopls-multi-2026-10-25.json](gopls-multi-2026-10-25.json) |

Memory is the sum over every gopls process of the run (daemon and forwarders included).
Private bytes are the stable figure; the working set of the shared daemon moves a lot between runs
because Windows trims it.

## Results (median of 3 runs)

| Projects | Separate — private | Shared — private | Change | Separate — WS | Shared — WS |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 643 MiB | 784 MiB | **+22%** | 516 MiB | 533 MiB |
| 3 | 1,932 MiB | 1,240 MiB | **−36%** | 1,550 MiB | 827 MiB |
| 5 | 2,750 MiB | 1,565 MiB | **−43%** | 2,207 MiB | 898 MiB |

- **Cost of each extra project:** ~527 MiB private with separate processes, ~195 MiB in the shared
  daemon (it shares the standard library and the common modules across sessions).
- **Load time is the same** in both modes (slowest project 9.6–13.2 s with 3–5 projects loading at once).
- With one project the daemon costs more: the forwarder process plus the daemon's own overhead.
- The first separate run with 3 projects (2,885 MiB private, 60–65 s load) had cold caches for the
  two projects added; it is kept in the raw data and excluded by the median.

## What this means for adOmnia

- With separate processes, five Go projects reach **2.75 GiB** of gopls alone. The application memory
  budget is RAM/8 between 1 and 3 GiB (`resources.DefaultMemoryBudget`), so on a 16 GB machine
  (2 GiB budget) the budget starts hibernating background gopls instances with three or four projects
  open, and each one reloads its workspace (5–10 s) when the user goes back to it.
- A shared daemon would keep five projects under the same budget without hibernation.

## Not yet proven

- **Editor latency in the shared daemon.** One `GOMEMLIMIT` of 768 MiB covers every project, so part of
  the saving may come from a busier GC. With one project, 512 MiB made completion ~4× slower
  ([typing-2026-10-24](typing-2026-10-24.md)). Before any change, measure completion/hover p50/p95 while
  typing in one project of five, shared versus separate, and with a limit that grows with the number of
  sessions.
- **Failure isolation.** One daemon crash takes every Go project down at once; a separate process only
  its own. A shared daemon needs central ownership, restart with replay of every session, and the
  explicit-start protection the per-session manager has today.
- Only Go: mixed Go + Java + Python sessions are still PERF-3.M2.
