# Go Studio acceptance audit — 2026-10-11

Windows amd64, Intel Core i7-14700KF. Base commit 05fc7e9 plus this local audit; no new release published.

## Reference checklist audit

Removed 10 obsolete duplicate capability entries from Reference: semantic graph, impact analysis, runtime-aware AI, drift detection and AI debugging. Implementations remain documented in P4. Broad usability/product objectives remain open. Reference now contains 125 open entries, 38 annotated partial.

Evidence: internal/ide/graph (fingerprint, store, risk, drift); internal/languages/golang/graph_test.go (type/dependency/interface impact and resources); frontend workspaceGraph/debugAI tests (10 focused tests including session memory and terminal restore passed). Updated obsolete claims about pprof/trace/govulncheck with actual code and passing backend tests. No provider or native UX acceptance inferred from unit tests.

## Recovery

Passed go test -v -count=1 -timeout=10m ./internal/goide -run 'Recover|KillDuring|Crash|Profile|TraceReport|DependencyGraph|Govuln'. Evidence: .artifacts/release-recovery-audit.log. Includes ten dirty buffers, persisted cursor/split state, corrupted snapshot fallback, moved projects and killing a child during bbolt snapshot writes. Profile/trace and vulnerability parser tests passed. This validates recovery components, not a packaged-app crash/reopen journey.

## Repeatable performance baseline

Run: go test ./internal/goide -run '^$' -bench BenchmarkReleaseRepository -benchtime=5x -count=1 -timeout=10m.

Fixtures: isolated temporary Go module, 10/100/1000 package folders with one approximately 4 KiB source file each, no external dependencies. Generation excluded; five repetitions; filesystem cache not cleared. Search verifies every expected match. Open creates a fresh backend service each iteration. B/op is cumulative allocated memory per operation, not RAM/RSS or retained heap.

| Go files | Backend open, mean ms | Full-tree search, mean ms | Open allocated MB/op | Search allocated MB/op |
| --- | ---: | ---: | ---: | ---: |
| 10 | 1.56 | 1.37 | 0.90 | 0.92 |
| 100 | 6.03 | 7.18 | 6.09 | 8.06 |
| 1000 | 50.48 | 59.83 | 54.77 | 80.05 |

Evidence: .artifacts/release-performance.log. Search allocation grows with file count; retain this baseline for comparisons. Not a claim about real-world monorepos, cold disk startup, editor first paint, gopls readiness/completion, idle CPU/RSS or Delve startup. Those measurements remain open.

## Native acceptance remaining

- [ ] Packaged application: open two projects, edit/save and restart, verify last selection and independent editor state.
- [ ] Abrupt app termination with unsaved buffers: reopen, inspect recovery and saved workspace integrity.
- [ ] Run/test/debug/terminal, cancellation and no orphaned processes.
- [ ] Dark/light/palette, keyboard and detached-window workflow.
- [ ] Real small/medium/large repositories: first editor, diagnostics/completion, search/definition, idle RSS/CPU and debug startup.

Native computer interaction is unavailable in this session. Starting Wails dev only proves startup/build and does not complete these manual checks. Existing manual M1–M32 gates remain open.


## P2 partial integrations

The eight previously partial entries are implemented; six independent P2 entries remain open. Details and limits: [P2 closure record](GO-STUDIO-P2-PARTIALS-2026-10-11.md). Desktop workflow acceptance remains in mds/todo-ide.md; native build/startup is distinct from manually exercising the flows.
