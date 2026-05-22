# adOmnia — Technical Audit Checklist

> Generated: 2026-05-22  
> Based on: full static analysis of all Go backend files, all React/TypeScript frontend files, and all stores.  
> Methodology: 5 parallel agents + direct code reads covering ~80 source files.

---

## Priority Legend

| Symbol | Level | Meaning |
|--------|-------|---------|
| 🔴 P0 | Critical | Breaks core functionality or renders a major feature non-functional |
| 🟠 P1 | Important | Significant bugs or incomplete features that strongly affect usability |
| 🟡 P2 | Medium | Polish, UX fixes, silent failures, technical debt |
| 🟢 P3 | Low | Nice-to-have enhancements and missing features |

---

## 🔴 P0 — Critical

---

### P0-1 — Plugin Event Bus is Never Consumed ✅ FIXED (2026-05-22)

- **Area**: Backend (`plugins.go`)
- **Evidence**: `eventBus: make(chan PluginEvent, 64)` is created in `PluginManager` but no goroutine ever reads from it. Plugin hook dispatch writes to this channel but nothing processes the events.
- **Why**: The plugin event/hook system silently drops all events. Hooks registered in plugin manifests are never triggered during app lifecycle events.
- **Fix applied**: Added `stopCh chan struct{}` to `PluginManager`, `eventDispatchLoop()` goroutine started in `Init()`, `FireEvent()` and `Shutdown()` methods added, `onStartup`/`onShutdown` lifecycle events fired from `app.go`, `globalPluginManager` assigned in `main.go`.
- **Acceptance criteria**: Install a test plugin with an `on_request` hook; verify the hook fires when a request is sent.

---

### P0-2 — WASM Plugin Runtime is an Explicit Stub ✅ DOCUMENTED (2026-05-22)

- **Area**: Backend (`plugins_sandbox.go`)
- **Evidence**: Comment at top of file: *"For the MVP, plugins execute as host functions mapped by ID (registry pattern). A real WASM runtime (wazero) would replace the simulated execution in the future."* Line 176: `fn, ok := sandbox.HostFuncs[req.Function]` — only pre-registered host functions can be called; no plugin code is actually executed.
- **Why**: Plugins cannot run custom logic. The plugin system UI (install, enable, inspect) works, but plugin code execution is a no-op. This makes the entire plugin feature non-functional for external plugin authors.
- **Fix applied**: Added `GetRuntimeMode()` to `WasmRuntime` returning `mode: "host-function"` and `wasmReady: false`. Added visible amber banner in `PluginPanel.tsx` — "Plugin execution mode: host-function only". WASM bytecode integration (wazero) remains on the roadmap.
- **Acceptance criteria**: Write a minimal WASM plugin that returns a transformed string; verify it executes and the result appears in the plugin panel.

---

### P0-3 — Proxy Breakpoints Never Actually Pause Traffic

- **Area**: Backend (`proxy.go`, `proxy_traffic.go`)
- **Evidence**: In `proxy_traffic.go`, `matchesAnyPattern(targetURL, breakpoints)` returns a boolean, and the match is logged — but the request is never held, paused, or sent to a UI-blocking callback. Traffic flows through unconditionally.
- **Why**: The ProxyPanel UI shows a breakpoints section that users can configure, creating the expectation that matching requests will pause for inspection/modification. They don't — traffic always passes through.
- **Fix**: Implement a request-hold mechanism: when a breakpoint matches, write the pending request to a channel, expose a `/proxy/breakpoint/pending` GET endpoint and a `/proxy/breakpoint/resume` POST endpoint, and have the frontend poll and allow editing before resuming.
- **Acceptance criteria**: Add a breakpoint for `/api/*`; send a request; verify the proxy panel shows the request paused and the response is only sent after the user clicks "Resume".

---

### P0-4 — LoadTest Compare Feature Compares a Result With Itself

- **Area**: Frontend (`frontend/src/components/loadtest/LoadTestPanel.tsx:159`)
- **Evidence**:
  ```typescript
  const data = await apiPost('/loadtest/compare', { result1: freshResult, result2: freshResult })
  ```
  Both `result1` and `result2` are the same `freshResult` object. The comparison will always show zero difference.
- **Why**: The compare feature is completely non-functional. It gives users false confidence that they are comparing two different test runs.
- **Fix**: Add a `baselineResult` state slot. When a user clicks "Set as Baseline", store the current result. When comparing, send `result1: baselineResult, result2: freshResult`.
- **Acceptance criteria**: Run two load tests with different concurrency settings; set the first as baseline; compare — verify the diff shows meaningful differences.

---

## 🟠 P1 — Important

---

### P1-1 — gRPC Client/Bidirectional Streaming Not Implemented

- **Area**: Backend + Frontend (`grpc.go:345-350`, `GrpcPanel.tsx:400`)
- **Evidence**: `grpc.go:348`:
  ```go
  writeJSON(w, http.StatusOK, grpcInvokeResponse{
      Error:  "client-streaming and bidirectional-streaming calls require an interactive stream sender and are not yet supported",
      Status: "UNIMPLEMENTED",
  })
  return
  ```
  Frontend shows a warning badge on streaming methods but still lets users attempt to invoke them, resulting in the error.
- **Why**: gRPC streaming is a fundamental feature. Many production gRPC APIs use server or bidirectional streaming. The current state silently rejects calls.
- **Fix**: Server-streaming is already partially implemented. Add client-streaming by wrapping requests into a proper gRPC stream via a long-lived HTTP/2 connection. Until complete, disable streaming method invocation buttons instead of failing silently.
- **Acceptance criteria**: Invoke a server-streaming RPC; verify all streamed messages appear in the response panel progressively.

---

### P1-2 — Flows Panel State is localStorage-Only (No Backend Persistence)

- **Area**: Frontend (`frontend/src/components/flows/FlowsPanel.tsx:196`)
- **Evidence**: `localStorage.setItem('adomnia.flows.v1', JSON.stringify(flows))` — flows are saved to `localStorage`, not to the bbolt backend storage. This means:
  - Flows are lost if the user clears localStorage
  - Flows are not included in workspace backups exported via the Vault
  - Flows cannot be synced across machines via workspace files
- **Why**: Every other major feature (collections, environments, settings, tabs) uses the backend storage. Flows break that invariant.
- **Fix**: Migrate flow persistence to `StoragePut('flows', 'all', JSON.stringify(flows))` / `StorageGet('flows', 'all')`, matching the pattern used in other stores.
- **Acceptance criteria**: Create a flow, close and reopen the app, verify the flow is restored. Export workspace via Vault; import on a fresh profile; verify flows appear.

---

### P1-3 — OAuth2 Only Supports client_credentials; No Token Caching

- **Area**: Frontend (`frontend/src/lib/sendRequest.ts:132-158`)
- **Evidence**:
  ```typescript
  const bodyParams = new URLSearchParams({ grant_type: 'client_credentials' })
  ```
  `fetchOAuth2Token` hardcodes `grant_type: 'client_credentials'`. No Authorization Code, PKCE, Implicit, or Resource Owner Password flows exist. Additionally, a new token is fetched on **every single request** — there is no caching or expiry tracking.
- **Why**: Most real-world OAuth2 protected APIs use Authorization Code + PKCE. Fetching a new token on each request causes rate limiting, slow sends, and unnecessary token endpoint load.
- **Fix**: (a) Add a `grant_type` field to the OAuth2 auth configuration. (b) Cache the token in memory with its `expires_in` TTL and only re-fetch when it expires. (c) Support PKCE for Authorization Code flow.
- **Acceptance criteria**: Configure OAuth2 with a token URL; send 10 rapid requests; verify only one token fetch occurred and all 10 requests succeeded with a cached token.

---

### P1-4 — Store Save Errors Are Silent; Users Never Know Data Was Not Persisted

- **Area**: Frontend (all persistent stores: `collections.ts:180`, `environments.ts:56`, `settings.ts:198`, `tabs.ts:98`)
- **Evidence**:
  ```typescript
  } catch (e) {
    console.error('Failed to save collections:', e)
    // No user notification, no retry, no dirty flag
  }
  ```
  If `StoragePut` fails (backend offline, bbolt locked, disk full), the user's changes silently fail to persist.
- **Why**: Users think they saved data that was actually lost. On next restart, the previous persisted state is restored without warning.
- **Fix**: Show a toast or StatusBar indicator on save failure. Add a `dirty` flag per store so users can see unsaved state. Optionally add exponential-backoff retry on transient failures.
- **Acceptance criteria**: Simulate a StoragePut failure; verify a visible error message appears in the UI; verify the dirty indicator is shown.

---

### P1-5 — Store Saves Not Awaited — Potential Out-of-Order Writes

- **Area**: Frontend (all persistent stores)
- **Evidence**: Every action in every persistent store follows this pattern:
  ```typescript
  set((s) => ({ /* update */ }))
  get().save()   // <-- NOT awaited
  ```
  Multiple rapid mutations (e.g., renaming 5 items quickly) dispatch 5 concurrent `save()` calls. Since bbolt writes are serialized but the JS call order is not guaranteed, an earlier state snapshot could win the race.
- **Why**: Under rapid user interaction (e.g., bulk delete, quick renames), data corruption or silent data loss is possible.
- **Fix**: Either (a) debounce saves (100–300 ms) so only the last state is saved, or (b) use a save queue that processes one write at a time. Debounce is the simpler fix.
- **Acceptance criteria**: Create 20 requests rapidly via keyboard; verify all 20 persist correctly after reload.

---

### P1-6 — SQLite Path Not Sanitized in Database Studio

- **Area**: Backend (`database_go.go`)
- **Evidence**: The `Connection.DSN` field for SQLite is used directly as a file path without `filepath.Clean()` or traversal checks. A crafted path like `../../etc/passwd` would be opened.
- **Why**: Path traversal vulnerability. A malicious workspace file could read arbitrary files from the user's system.
- **Fix**: Apply `filepath.Clean()` and verify the resolved path is under the app's data directory or explicitly allow only absolute paths the user selects via a file dialog.
- **Acceptance criteria**: Attempt to open `../../etc/hosts` as a SQLite database; verify the backend returns an error instead of reading the file.

---

### P1-7 — SaveSettings Stores Malformed JSON Without Validation

- **Area**: Backend (`settings_bindings.go:22-27`)
- **Evidence**:
  ```go
  func (a *App) SaveSettings(settingsJSON string) error {
      return storePut(settingsBucket, settingsKey, []byte(settingsJSON))
  }
  ```
  No `json.Valid()` check. If the frontend sends malformed JSON (bug, race condition, encoding error), invalid bytes are stored. On next load, `json.Unmarshal` fails silently and the app falls back to defaults, silently wiping user settings.
- **Why**: Settings corruption is catastrophic and invisible.
- **Fix**: Add `if !json.Valid([]byte(settingsJSON)) { return fmt.Errorf("invalid settings JSON") }` before storing.
- **Acceptance criteria**: Call `SaveSettings("{invalid json")` from the frontend; verify it returns an error and existing settings are preserved.

---

### P1-8 — "Performance Overlay" Toggle in Settings Is Dead Code

- **Area**: Frontend (`frontend/src/components/settings/SettingsPanel.tsx:1042-1045`)
- **Evidence**:
  ```tsx
  <Toggle
    label={s.developer.showPerfOverlay}
    checked={false}             // HARDCODED
    onChange={() => {
      console.log('Toggle perf overlay — not yet implemented')
    }}
  />
  ```
  The toggle is permanently off and logs to console instead of doing anything.
- **Why**: Presents a UI control to users that has no effect. The `console.log` is also a coding standards violation.
- **Fix**: Either implement the performance overlay (React DevTools Profiler integration, FPS counter, etc.) or remove the toggle from the UI entirely until implemented.
- **Acceptance criteria**: Toggle disappears from the Developer settings section OR toggling it visibly activates a performance overlay.

---

### P1-9 — HTTP Sidecar Server Has No Graceful Shutdown

- **Area**: Backend (`server.go:168-175`, `app.go:266-280`)
- **Evidence**:
  ```go
  go func() {
      if err := http.Serve(ln, handler); err != nil { ... }
  }()
  ```
  The server is started with no reference stored. `OnShutdown` in `app.go` shuts down Python bridge, browser debug, WebSocket, SSE, and bbolt — but not the HTTP sidecar.
- **Why**: In-flight requests (load test, long SSE, proxy) are hard-killed without a chance to complete or close cleanly. On rapid app restart, the old port may still be bound briefly.
- **Fix**: Store an `*http.Server` reference globally. In `OnShutdown`, call `httpServer.Shutdown(ctx)` with a 2-second timeout before closing the store.
- **Acceptance criteria**: Start a long SSE stream; close the app; verify no OS port binding error occurs on immediate relaunch.

---

### P1-10 — proxy_traffic.go Response Timing Metric Is Always Zero

- **Area**: Backend (`proxy_traffic.go`)
- **Evidence**: The `timing.ResponseRecv` field is computed as `time.Since(respEnd)` but `respEnd` is never initialized — it stays at its zero value. Every proxied request reports `ResponseRecv = 0`.
- **Why**: Network timing waterfall in the ProxyPanel shows misleading/wrong timing data for HTTPS-intercepted traffic.
- **Fix**: Record `respEnd = time.Now()` immediately after `io.ReadAll(resp.Body)` completes.
- **Acceptance criteria**: Proxy a slow HTTP request; verify the response-receive timing shown in the traffic panel is non-zero and plausible.

---

## 🟡 P2 — Medium Priority

---

### P2-1 — Sidebar Collapsed State Not Persisted

- **Area**: Frontend (`frontend/src/stores/app.ts:65,81`)
- **Evidence**: `sidebarCollapsed: false` is in `app.ts` but `app.ts` has no persistence layer. Every app restart resets the sidebar to expanded regardless of user preference.
- **Fix**: Move `sidebarCollapsed` into `settings.ts` (under `appearance`) so it's saved via `SaveSettings`.
- **Acceptance criteria**: Collapse the sidebar; close and reopen the app; verify the sidebar remains collapsed.

---

### P2-2 — defaultRail Saved to localStorage Instead of Settings

- **Area**: Frontend (`frontend/src/App.tsx:118`)
- **Evidence**:
  ```typescript
  useEffect(() => {
    localStorage.setItem('adomnia.defaultRail', defaultStartupRail)
  }, [defaultStartupRail])
  ```
  This creates a dual persistence path — the setting lives in settings.ts (backend), but the active rail is also saved to `localStorage`, which may diverge.
- **Fix**: Remove the `localStorage.setItem` from `App.tsx`; read `defaultStartupRail` exclusively from the settings store which already persists it via the backend.
- **Acceptance criteria**: Change the default startup rail; close and reopen; verify the correct rail opens without reading `localStorage`.

---

### P2-3 — CollectionTree Uses window.alert and window.prompt

- **Area**: Frontend (`frontend/src/components/collections/CollectionTree.tsx`)
- **Evidence**: Import error feedback uses `window.alert()` (line 375); move-request dialog uses `window.prompt()` (line 399). Both are native browser dialogs that block the UI and are visually inconsistent with the app's design.
- **Fix**: Replace `window.alert` with the existing `confirm-dialog` or toast system. Replace `window.prompt` with the existing `prompt.tsx` modal component.
- **Acceptance criteria**: Trigger an import error; verify a styled, non-blocking toast appears instead of a browser alert. Trigger a move-request action; verify a styled modal appears instead of a native prompt.

---

### P2-4 — console.info Left in CollectionTree Production Code

- **Area**: Frontend (`frontend/src/components/collections/CollectionTree.tsx:373`)
- **Evidence**:
  ```typescript
  console.info(`Imported ${result.collections.length} ${result.format} collection(s)`)
  ```
- **Fix**: Remove the console statement. If logging is needed, route it through the devLogs system (`RecordFrontendLog`).
- **Acceptance criteria**: Import a collection; verify no console.info appears in DevTools.

---

### P2-5 — ResponsePanel JSON Parse Failure Is Silent

- **Area**: Frontend (`frontend/src/components/response/ResponsePanel.tsx`)
- **Evidence**: When the response body is not valid JSON but the user is in the JSON view, the panel silently stays in raw view. No toast, no badge, no message tells the user that JSON parsing failed.
- **Fix**: Display a small inline notice ("Response is not valid JSON — showing raw") when `JSON.parse` throws inside the JSON viewer.
- **Acceptance criteria**: Send a request that returns plain text; switch to JSON view; verify a user-friendly notice appears explaining the parse failure.

---

### P2-6 — "Beautify" Button in ResponsePanel Copies to Clipboard, Not Beautifies

- **Area**: Frontend (`frontend/src/components/response/ResponsePanel.tsx`)
- **Evidence**: The button labeled "Beautify" (or similar) calls clipboard copy on non-JSON bodies instead of formatting and displaying the content in-place.
- **Fix**: Implement in-place beautification: re-set the displayed body to `JSON.stringify(parsed, null, 2)` for JSON, or use a basic XML/HTML formatter for those content types.
- **Acceptance criteria**: Send a minified JSON response; click "Beautify"; verify the panel content is reformatted with indentation without copying to clipboard.

---

### P2-7 — No Debouncing on Store Saves Causes Excessive Backend Writes

- **Area**: Frontend (all persistent stores)
- **Evidence**: Editing a request URL (character by character) triggers a `StoragePut` call per keystroke through the `updateRequest` action in `tabs.ts`.
- **Fix**: Add a 200–300 ms debounce to the `save()` function in each persistent store using `setTimeout/clearTimeout`.
- **Acceptance criteria**: Type 20 characters in the URL bar; verify at most 2–3 StoragePut calls are made (visible in the DevLogs panel).

---

### P2-8 — proxy_rules.go CIDR Table Rebuilt in Unlocked Goroutine

- **Area**: Backend (`proxy_rules.go`)
- **Evidence**: After updating `proxyRules` under `proxyRulesMu`, the code calls `go buildCIDRTable()`. The goroutine starts after the mutex is released, so it reads `proxyRules` without holding the lock.
- **Fix**: Either run `buildCIDRTable()` synchronously before releasing the mutex, or pass a snapshot of the rules as a function argument.
- **Acceptance criteria**: Run the Go race detector (`go test -race`) and verify no data race is reported for `proxyRules`.

---

### P2-9 — themes_extended.go StopWatching May Deadlock

- **Area**: Backend (`themes_extended.go`)
- **Evidence**: `StopWatching()` sends to the `stop` channel but doesn't drain it if the `watchLoop` goroutine has already exited (e.g., on a second call). This can cause the send to block forever if the channel is unbuffered.
- **Fix**: Use `select { case watcher.stop <- struct{}{}: default: }` for a non-blocking send, or use `sync.Once` to ensure stop is only called once.
- **Acceptance criteria**: Call `StopWatching()` twice in a row; verify no deadlock or hang occurs.

---

### P2-10 — Plugin EntryPoint Not Re-Validated at Execution Time

- **Area**: Backend (`plugins.go`)
- **Evidence**: When loading a plugin manifest, `isUnderDir()` is checked. But when executing a plugin action, the `EntryPoint` field from the loaded manifest is used directly without re-validating that it still points to a path within the plugin directory.
- **Fix**: Re-apply `isUnderDir(pluginsBaseDir, resolvedEntryPoint)` check at execution time.
- **Acceptance criteria**: Manually edit an installed plugin's manifest to point `entryPoint` outside the plugins directory; verify execution returns an error instead of accessing the path.

---

### P2-11 — Collections Store Has No Version Field for Migrations

- **Area**: Frontend (`frontend/src/stores/collections.ts`)
- **Evidence**: `migrateCollections()` runs structural migrations on every load but has no version number on the collection root object to know which migrations have been applied.
- **Why**: If new migrations are added in a future release, there's no way to skip already-applied migrations or know the current schema version.
- **Fix**: Add `version: number` to the persisted collection root; increment it with each migration pass; skip migrations for versions that are already at or above the current schema version.
- **Acceptance criteria**: Run a migration twice; verify the data is not double-migrated.

---

### P2-12 — Settings Deep Merge Drops Array-Type Fields

- **Area**: Frontend (`frontend/src/stores/settings.ts:173-187`)
- **Evidence**: The merge logic uses object spread, which replaces arrays entirely instead of merging them. If a future `AppSettings` version adds an array-type field with defaults, users upgrading from an older saved settings blob will get an empty array instead of the defaults.
- **Fix**: Explicitly handle array fields in the merge by checking `Array.isArray` and keeping defaults when the saved value is `undefined`.
- **Acceptance criteria**: Add a new array field to `AppSettings` defaults; load old saved settings that don't include it; verify the field is populated with defaults, not empty.

---

### P2-13 — Kafka Consumer Group Goroutine May Outlive HTTP Request Context

- **Area**: Backend (`kafka.go:345-361`)
- **Evidence**: The consumer group is started in a goroutine:
  ```go
  go func() { _ = group.Consume(ctx, [...], handler) }()
  ```
  If the HTTP request context is cancelled (client disconnect, timeout), the goroutine may not stop immediately because `group.Consume` has its own internal loop.
- **Fix**: After the context is done, explicitly call `group.Close()` to ensure the consumer loop exits. Use `defer group.Close()` outside the goroutine.
- **Acceptance criteria**: Start consuming, then disconnect the frontend; verify the goroutine count does not grow unboundedly (check via pprof).

---

### P2-14 — LoadTest Duration Mode Leaves a Goroutine Orphaned

- **Area**: Backend (`loadtest.go:164-169`)
- **Evidence**:
  ```go
  done := make(chan struct{})
  if req.DurationS > 0 {
      go func() {
          time.Sleep(time.Duration(req.DurationS) * time.Second)
          close(done)
      }()
  }
  // If DurationS <= 0, done channel is never closed
  ```
  In `TotalReqs` mode (`DurationS == 0`), the `done` channel is created but never closed. Any code selecting on `done` blocks forever.
- **Fix**: When `DurationS <= 0`, either don't create `done` and use a separate `bool` flag, or immediately close `done` so selects fall through.
- **Acceptance criteria**: Run a load test in request-count mode (not duration mode); verify no goroutine leak via pprof.

---

## 🟢 P3 — Nice-to-Have

---

### P3-1 — WebSocket: Missing Binary Messages, Auto-Reconnect, Message Filter

- **Area**: Frontend/Backend (`frontend/src/components/websocket/WebSocketPanel.tsx`)
- **Evidence**: TODO.md lists these as missing: binary message sending, sub-protocol selection, auto-reconnect on disconnect, URL history, message filter/search, message export.
- **Fix**: Add each incrementally. Binary messages first (most requested). Auto-reconnect second (UX impact). Others as follow-up.
- **Acceptance criteria**: Send a binary (ArrayBuffer) WebSocket message; verify the server receives it correctly.

---

### P3-2 — GraphQL: No Schema Introspection

- **Area**: Frontend (`frontend/src/lib/types.ts`, Composer)
- **Evidence**: GraphQL body type exists (raw query + variables) but there is no introspection query, schema explorer, or field autocompletion.
- **Fix**: When a request has `Content-Type: application/graphql` or `body.type === 'graphql'`, offer a "Load Schema" button that runs the `{ __schema { ... } }` introspection query and renders a type browser.
- **Acceptance criteria**: Point the composer at a GraphQL endpoint; click "Load Schema"; verify types appear in an explorer panel.

---

### P3-3 — Code Generation: Missing Java, Ruby, Rust, Swift, Kotlin Targets

- **Area**: Frontend (`frontend/src/lib/codegen.ts`)
- **Evidence**: Current generators: cURL, JavaScript (fetch), Python, Go, PHP, C#. Missing: Java (OkHttp), Ruby (Net::HTTP), Rust (reqwest), Swift (URLSession), Kotlin (OkHttp), shell/wget.
- **Fix**: Add each target as a new `case` in the `codegen.ts` switch. These are mechanical string templates.
- **Acceptance criteria**: Select "Java (OkHttp)" from the code generator; verify a valid, compilable snippet is produced.

---

### P3-4 — Cookie Editor Missing

- **Area**: Frontend (Composer)
- **Evidence**: TODO.md: `[ ] Cookie editor per singole richieste`. There is no way to set cookies per-request without manually adding a `Cookie` header.
- **Fix**: Add a "Cookies" tab to the Composer alongside Headers and Params, with a KV editor that serializes to a `Cookie: key=value; key2=value2` header on send.
- **Acceptance criteria**: Add a cookie in the Cookies tab; send the request; verify the server receives the `Cookie` header.

---

### P3-5 — gRPC Proto File Parsing Uses Regex (Fragile)

- **Area**: Frontend (`frontend/src/components/grpc/GrpcPanel.tsx:27-48`)
- **Evidence**: Proto file upload uses regex patterns to extract service/method names from `.proto` text. This fails on comments, multi-line definitions, nested messages, and non-standard formatting.
- **Fix**: Use a proper proto file parser library (e.g., `protobufjs/proto3-parser`) in the frontend, or send the proto file to the backend for parsing via a new `/grpc/parse-proto` endpoint.
- **Acceptance criteria**: Upload a proto file with inline comments and nested messages; verify all services and methods are correctly extracted.

---

### P3-6 — Observability Panel Has No Real-Time Log Streaming

- **Area**: Frontend (`frontend/src/components/observe/ObservabilityPanel.tsx`)
- **Evidence**: The panel reads from static log files via `readLogFile()`. It cannot stream live logs. Users must manually refresh to see new entries.
- **Fix**: Add a `/devlogs/stream` SSE endpoint in the backend that tails the current log file and streams new lines. Subscribe in the ObservabilityPanel.
- **Acceptance criteria**: Open the Observability panel; send a request; verify new log entries appear automatically without refreshing.

---

### P3-7 — Collection Sidebar Has No Keyboard Navigation

- **Area**: Frontend (`frontend/src/components/collections/CollectionTree.tsx`)
- **Evidence**: TODO.md: `[ ] Navigazione da tastiera (frecce, Enter)`. Navigating a large collection requires mouse-only interaction.
- **Fix**: Add `onKeyDown` handlers for `ArrowUp`, `ArrowDown`, `ArrowRight` (expand), `ArrowLeft` (collapse), `Enter` (open in tab), and `Delete` (prompt delete) on tree nodes.
- **Acceptance criteria**: Focus the collection tree; navigate with arrow keys; press Enter to open a request in a new tab.

---

### P3-8 — Collection Runner Lacks Parallel Execution Mode

- **Area**: Frontend (`frontend/src/components/runner/RunnerPanel.tsx`)
- **Evidence**: The runner executes requests sequentially. There is no parallel/concurrent mode for load-like collection runs.
- **Fix**: Add a "Max parallel" spinner (default: 1 = sequential). When > 1, use `Promise.allSettled` with batching.
- **Acceptance criteria**: Set parallel to 3; run a 9-request collection; verify 3 run simultaneously and results are aggregated correctly.

---

### P3-9 — SOAP Code Generator Leaves console.log in Generated Node.js Snippet

- **Area**: Frontend (`frontend/src/lib/soapClient.ts:549`)
- **Evidence**:
  ```typescript
  res.on('end', () => { console.log(res.statusCode, data); });
  ```
  This is inside a template literal that generates example Node.js code. While not a runtime bug (it's generated code, not executed code), it produces low-quality boilerplate that a developer would have to clean up.
- **Fix**: Replace `console.log(res.statusCode, data)` in the template with a proper `console.log(data)` example or a comment explaining how to handle the response.
- **Acceptance criteria**: Open the SOAP code generator; copy the Node.js snippet; verify it uses a logger or prints only the meaningful data.

---

### P3-10 — Tab Restoration Silently Destroys All Tabs When Disabled

- **Area**: Frontend (`frontend/src/stores/tabs.ts:66-68`)
- **Evidence**:
  ```typescript
  const restoredTabs = settings.general.restoreTabsOnStartup
    ? (parsed.tabs ?? []).map(cleanLoadedTab)
    : []
  ```
  If the user disables "Restore tabs on startup" and restarts, all saved tabs are silently discarded with no warning.
- **Fix**: When `restoreTabsOnStartup` is turned off, show a confirmation dialog: "Disabling this will close all tabs on next restart. Continue?" If confirmed, clear the saved tabs immediately rather than on next startup.
- **Acceptance criteria**: Disable the setting with open tabs; verify a warning is shown; on next restart, verify tabs are cleared as expected.

---

## Appendix: Already-Fixed Items (Verified During Audit)

The following were flagged in `docs/TODO.md` but confirmed fixed in the current codebase:

| Item | Status |
|------|--------|
| `vault.go:141-154` — Identity not stored | **FIXED** — `vaultIdentity = identity` is present at line 149 |
| Pre/post script execution — no engine | **FIXED** — `scriptRuntime.ts` uses Web Workers with proper timeout |
| Timeout per-tab and Follow Redirects | **FIXED** — Present in `Composer.tsx` and wired to `sendRequest.ts` |
| savedFlash state not triggering | **FIXED** — State wired correctly in `Composer.tsx` |
| Browser debug temporary profile | **FIXED** — Uses `os.MkdirTemp` |
| WebSocket/SSE session limits | **FIXED** — 20-session cap, idle reaper implemented |

---

*End of audit — 10 P0/P1 critical issues, 14 P2 medium issues, 10 P3 improvements.*
