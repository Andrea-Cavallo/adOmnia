# Typing latency while the app is working — 2026-11-04

How long a keypress takes to reach the screen while tests, a log flood, a debugger and gopls are busy. Initial target: p95 under 50 ms.

| | |
| --- | --- |
| Host | Windows 11 Pro 26300, i7-14700KF (28 logical CPUs), 63.8 GB RAM |
| App | production build in the real WebView2, a clean profile for each build |
| Typing | 300 keys, one every 60 ms, at the end of a 5,000-line Go file, gopls loaded |
| Latency | `keydown` to the task after the next frame (`requestAnimationFrame` + `MessageChannel`) |
| Tool | [`scripts/perf-typing/run.ps1`](../../scripts/perf-typing/run.ps1); a scenario counts only if the cursor moved by exactly 300 columns |

## Results

| Work in progress | p50 | p95 before | p95 after | p99 before | p99 after | Long tasks before → after | Main thread busy before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Nothing | 15 ms | 20.2 ms | 20.3 ms | 21.0 ms | 21.9 ms | 0 → 0 | 33% → 35% |
| **Log flood in the Run console** | 18 ms | **61.1 ms** | **23.8 ms** | 71.4 ms | 27.2 ms | **35 → 1** | **100% → 69%** |
| 6,000 subtests, Tests window open | 16 ms | 20.2 ms | 20.4 ms | 20.9 ms | 21.4 ms | 0 → 0 | 42% → 48% |
| Delve session writing 200 lines/s, Debug window open | 16 ms | 20.3 ms | 20.0 ms | 21.7 ms | 21.0 ms | 0 → 0 | 43% → 38% |
| gopls reloading 150 packages full of type errors, 150 files changing every 3 s | 17 ms | 20.3 ms | 20.7 ms | 22.6 ms | 25.1 ms | 0 → 1 | 45% → 49% |

"Before" is `c589ca9e`. Every "after" p95 is under the target. Only the log flood was over it. The differences in the other rows are too small to mean anything with one run per build.

## What was wrong in the console

The flood writes as fast as the backend accepts, so the 4 MB console buffer stays full. Then:

- **The incremental parser stopped being incremental.** Its cache was keyed by the first chunk, which changes as soon as the buffer drops its oldest one, so all 4 MB were parsed again at each update. The link regex alone took 9.8 s of the 18 s measured. The cache now follows the last chunk seen and removes the lines of the dropped chunks.
- **The link regex ran on every line.** A quick test for `.go:`, `.java:` and the like now skips the lines that cannot match.
- **The server URL scan joined the whole buffer at each update.** The parser now finds it once, line by line.
- **Row keys contained the position in the list**, so React rebuilt all 1,000 visible rows at each update. Rows now have a stable id and are memoized. Rows off screen skip layout (`content-visibility`).
- **One store update per output event.** Console and debug output now reach their stores at most about eight times per second; the first chunk still arrives at once, so an interactive program's echo is not delayed.
- **A hidden console no longer parses.** It catches up when it is shown.

## Limits of this measurement

- One run of 18 s per scenario on a fast desktop: it shows the shape, not a stable percentile. The 10-minute scenarios of [PERFORMANCE.md](../PERFORMANCE.md) and a slower machine are still to do.
- Keys come through the DevTools protocol, so OS and driver input latency are not included.
- The 5,000-line file has a very long line by the end of the run, and the Tests window had its tree closed. A `large.go` of 50,000 lines under load was not measured.
- Windows only.
