# Startup performance

adOmnia renders its shell and restores the workspace before starting optional
tools. This is a loading optimization, not a change to the workspace format or
the set of supported API, database and broker features.

## What is deferred

- The collection sidebar is not requested on a fresh Hub. A persisted API
  destination preloads it alongside the request workspace during module
  evaluation, overlapping the bootstrap load.
- The command palette and development log overlay load when opened.
- Environment and hosts editors load when opened, including in restored API
  workspaces. Their compact switchers remain available in the sidebar.
- A disconnected/unverified AI companion does not load its chat or provider
  runtime. A verified companion mounts after the first stable frame; an early
  Hub click can request it immediately and is retained while the chunk loads.
- File-drop imports load their collection/environment parsers on demand.
- AI gateway restoration imports the provider runtime only after the first
  frame and only if AI and the gateway are enabled.
- YAML has its own vendor chunk. It no longer shares a startup chunk with
  Zustand and the UI utility libraries.

Existing deferred panels, workspace hydration, startup backups and active-tab
restoration are preserved. No credentials are resolved by these loading checks.

## Production graph check

```bash
npm --prefix frontend run check:startup
```

The script builds the production graph in memory without replacing
`frontend/dist`. It walks the entry chunks' static imports, reports their
uncompressed JavaScript bytes, and fails above 650,000 bytes or if guarded
optional modules enter that graph. Dynamic imports are not included. Conditional
runtime preloads for restored API workspaces are therefore outside this number.
Images, CSS, fonts, worker payloads and the native executable are also excluded.

For a diagnostic report without enforcing the budget:

```bash
cd frontend
node scripts/check-startup-bundle.mjs --report-only
```

The desktop build workflow runs the budget on each change. It guards startup
loading strategy; it is not a benchmark of native launch time or total app size.

## Measurements: 2026-09-27

The baseline was the working tree after game extraction, before startup
deferral. Both graph measurements used the same installed toolchain.

| Measurement | Before | After |
| --- | ---: | ---: |
| Static initial JavaScript, uncompressed | 823,684 bytes | 572,407 bytes |
| Guarded deferred app modules present initially | 7 | 0 |
| Warm-cache renderer first-frame median, 3 samples | 83.8 ms | 80.9 ms |

Initial JavaScript is reduced by 251,277 bytes (30.5%). The small timing sample
does not establish a comparable native startup speedup. Browser samples used
the production preview at `127.0.0.1:5175` with an empty workspace and no Wails
backend: before 66.5 / 83.8 / 87.7 ms, after 84.7 / 80.9 / 77.2 ms. No hydration
skeleton appeared in these Hub samples.

## Timing diagnostics and limitations

`startupPerformance.ts` uses local Performance API marks for renderer mount,
bootstrap hydration, workspace-bundle loading and the first stable shell frame.
The HTML element's `data-startup-performance` attribute exposes numeric timing
and payload-size diagnostics for local smoke checks. It contains no workspace
contents, names, credentials or remote telemetry. Diagnostics failures cannot
interrupt the first-frame notification.

The renderer-entry mark is recorded when the entry module executes, after its
static imports. It does not measure the earlier cost of downloading, parsing
and evaluating that static graph. Nor does the first-frame mark guarantee that
every lazy panel/editor is ready. Native process launch, WebView initialization
and actual Go bootstrap need a separate Wails measurement on the target machine.
Use the built desktop with both an empty Hub and representative persisted API
workspaces; compare cold and warm launches separately rather than extrapolating
from browser preview reloads.
