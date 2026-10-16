# gopls resource optimization — 2026-10-16

## Changes

- Serialize crash retries with start/stop/close and invalidate retries after a lifecycle change. Mark a server closed before releasing its lifecycle lock.
- Re-arm automatic idle suspension after a successful crash restart. Existing safeguards remain: open/dirty editors, active windows, pending requests and explicit user starts prevent suspension; automatic servers without tracked editors may suspend after five minutes.
- Default `GOMEMLIMIT` reduced from `1GiB` to `768MiB`. Explicit inherited environment settings still win. This is a GC budget, not a resident-memory cap.
- Accept the standalone `-` directory filter in Settings so users can exclude everything and explicitly include selected modules. Full module scope remains the compatible default.

## Measurements

Windows, locally installed gopls, this adOmnia repository. Fresh server per case, shared warm filesystem/build caches. Initialize, search `LSPManager`, open `internal/goide/lsp.go`, request non-empty hover, wait two seconds, sample resident memory, then average five workspace-symbol requests. Process CPU is cumulative user + system time. The application's existing gopls remains separate. No network benchmark or native UI interaction is involved.

| Budget | RSS MiB (two runs) | First symbol load ms | Hover ms | Warm symbol mean ms | CPU seconds |
|---|---|---|---|---|---|
| 1 GiB | 806.5 / 681.3 | 8652 / 10557 | 213 / 144 | 73.7 / 47.3 | 14.03 / 8.23 |
| 768 MiB | 562.0 / 582.7 | 9339 / 9379 | 181 / 160 | 45.6 / 42.7 | 8.17 / 8.94 |
| 512 MiB | 443.5 / 414.1 | 10323 / 9264 | 173 / 164 | 80.7 / 48.1 | 14.22 / 8.95 |

Mean sampled RSS fell about 23% at 768 MiB versus 1 GiB. 512 MiB saved more, but its first run used more CPU and had slower symbol requests than 768 MiB. Choose 768 MiB as a conservative default; these few samples do not establish p95 latency, peak RSS or prolonged editing behavior.

Selected-directory rules `-`, `+internal/goide`, `-**/node_modules` at 768 MiB: RSS 709.6 MiB, initial symbols 8140 ms, hover 246 ms, warm symbols 16.1 ms, cumulative CPU 6.16 s, 89 symbol results versus 100 in full scope. Narrowing reduced search scope and work but did not guarantee lower sampled RSS. Do not blanket-exclude Go source, generated code or vendor dependencies.

The earlier symbol-only exploratory run, without opening the editor/hover, measured nested `internal/goide` with module expansion disabled at 461.0 MiB versus full scope 660.0 MiB at 768 MiB. This is a different workload and is not directly comparable to the table.

Repeating the nested-directory case with the editor/hover workload measured RSS 618.9 MiB, symbol load 10552 ms, hover 125 ms, warm symbols 50.0 ms and CPU 6.91 s. This confirms that reducing module expansion is workload-dependent rather than an automatic memory saving.

## Reproduce

```powershell
$env:ADOMNIA_MEASURE_LSP_ROOT = (Get-Location).Path
$env:ADOMNIA_MEASURE_LSP_BINARY = "$env:APPDATA\adomnia\goide\tools\bin\gopls.exe"
go test ./internal/goide -run '^TestMeasureLanguageServerMemory$' -v -count=1 -timeout 10m
```

The measurement is opt-in and skips ordinary test runs. Each case closes its server and asserts that its actual OS process no longer runs.

## Validation boundaries

- Real-server memory, hover, symbol search and process exit were measured.
- Focused lifecycle tests cover idle/resume, explicit user pins, crash backoff, lifecycle serialization, handshake, separate sessions and session resource cleanup.
- Go adapter/LSP tests, Go build, TypeScript, frontend build, focused synchronization/settings export tests and startup budget are integration checks.
- Manual Wails checks remain pending: close a project from its UI, inspect the resource monitor, reopen it, and verify completion/diagnostics/cross-package rename on a representative large project with custom filters. The already-running application does not pick up compiled-code changes until a newly built executable is started.
- No persisted settings or workspace schema changed. Existing unrelated working-tree changes were preserved.

Settings semantics: https://go.dev/gopls/settings
