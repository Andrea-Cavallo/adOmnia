# Startup follow-up: items 2, 3 and 5

Verified on Windows, 2 November 2026. The Monaco refactor (item 1) was handled separately.

- Hub no longer prestarts Code Studio/gopls. Quick Open builds its cached index on demand; restored-unit detection remains enabled for correctness.
- Optional skin CSS and handwriting fonts load on selection. Initial CSS in the tested build changed from 207,750 to 196,231 bytes. The startup check also rejects eager optional skin styles.
- WebView2 receives `--disable-background-networking` and `--disable-component-update`. GPU process isolation remains enabled. The system runtime updater is unchanged.

Evidence from a release executable with an isolated profile: native Hub booted without a UI error, explicit localhost HTTP worked, and Sketch, Terminal Green and Static Citrine switched successfully. The freqtrade project had no index build before Quick Open; its first query indexed 761 files and returned 20 results in approximately 25 ms. Focused Go tests, eleven frontend tests, frontend build and startup budget passed at implementation time.

The later idle sampling was invalid because the QA application exited during sampling. No new idle percentage, ready latency or RAM reduction is claimed. Repeat the five-start benchmark on the integrated build, with no concurrent builds and with process creation timestamps checked to avoid PID reuse in process-tree attribution.

Integration validation before the develop push: all 2,473 frontend tests (501 files), frontend production build, startup-budget check and `go build ./...` passed. The idle JSON produced after the interrupted QA run is invalid and must not be treated as a zero-CPU result.

The complete Go run initially found a same-timestamp worktree-index export failure. Export now seeds a fresh temporary index from HEAD, preserving the real index and correctly reading same-size edits. The affected patch/evidence tests passed eight repetitions. A C++ diagnostic test now removes its previous build output before checking invalid source, avoiding make timestamp-resolution flakes. Declared-language/tool-manifest tests and the Go build passed after these fixes; the complete frontend suite passed as noted above.
