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

### P0-2 — WASM Plugin Runtime is an Explicit Stub ✅ DOCUMENTED (2026-05-22)

### P0-3 — Proxy Breakpoints Never Actually Pause Traffic ✅ FIXED (2026-05-22)

### P0-4 — LoadTest Compare Feature Compares a Result With Itself ✅ FIXED (2026-05-22)

## 🟠 P1 — Important

---

### P1-1 — gRPC Client/Bidirectional Streaming Not Implemented ✅ MITIGATED (2026-05-22)

### P1-2 — Flows Panel State is localStorage-Only (No Backend Persistence) ✅ FIXED (2026-05-22)

### P1-3 — OAuth2 Only Supports client_credentials; No Token Caching ✅ FIXED (2026-05-22)

### P1-4 — Store Save Errors Are Silent; Users Never Know Data Was Not Persisted ✅ FIXED (2026-05-22)

### P1-5 — Store Saves Not Awaited — Potential Out-of-Order Writes ✅ FIXED (2026-05-22)

### P1-6 — SQLite Path Not Sanitized in Database Studio ✅ FIXED (2026-05-22)

### P1-7 — SaveSettings Stores Malformed JSON Without Validation ✅ FIXED (2026-05-22)

### P1-8 — "Performance Overlay" Toggle in Settings Is Dead Code ✅ FIXED (2026-05-22)

### P1-9 — HTTP Sidecar Server Has No Graceful Shutdown ✅ FIXED (2026-05-22)

### P1-10 — proxy_traffic.go Response Timing Metric Is Always Zero ✅ FIXED (2026-05-22)

## 🟡 P2 — Medium Priority

---

### P2-1 — Sidebar Collapsed State Not Persisted ✅ FIXED (2026-05-22)

### P2-2 — defaultRail Saved to localStorage Instead of Settings ✅ FIXED (2026-05-22)

### P2-3 — CollectionTree Uses window.alert and window.prompt ✅ FIXED (2026-05-22)

### P2-4 — console.info Left in CollectionTree Production Code ✅ FIXED (2026-05-22)

### P2-5 — ResponsePanel JSON Parse Failure Is Silent ✅ FIXED (2026-05-22)

### P2-6 — "Beautify" Button in ResponsePanel Copies to Clipboard, Not Beautifies ✅ FIXED (2026-05-22)

### P2-7 — No Debouncing on Store Saves Causes Excessive Backend Writes ✅ FIXED (2026-05-22)


### P2-8 — proxy_rules.go CIDR Table Rebuilt in Unlocked Goroutine ✅ FIXED (2026-05-22)


### P2-9 — themes_extended.go StopWatching May Deadlock ✅ FIXED (2026-05-22)


### P2-10 — Plugin EntryPoint Not Re-Validated at Execution Time ✅ FIXED (2026-05-22)

---

### P2-11 — Collections Store Has No Version Field for Migrations ✅ FIXED (2026-05-22)

### P2-12 — Settings Deep Merge Drops Array-Type Fields ✅ FIXED (2026-05-22)

### P2-13 — Kafka Consumer Group Goroutine May Outlive HTTP Request Context ✅ VERIFIED (2026-05-22)

### P2-14 — LoadTest Duration Mode Leaves a Goroutine Orphaned ✅ FIXED (2026-05-22)

---

## 🟢 P3 — Nice-to-Have

---

### P3-1 — WebSocket: Missing Binary Messages, Auto-Reconnect, Message Filter ✅ FIXED (2026-05-22)


---

### P3-2 — GraphQL: No Schema Introspection ✅ FIXED (2026-05-22)


---

### P3-3 — Code Generation: Missing Java, Ruby, Rust, Swift, Kotlin Targets ✅ FIXED (2026-05-23)

All targets already implemented: Java (OkHttp), Ruby (Net::HTTP), Rust (reqwest), Swift (URLSession), Kotlin (OkHttp), shell/wget — verified in `codegen.ts`.

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

### P3-7 — Collection Sidebar Has No Keyboard Navigation ✅ FIXED (2026-05-23)

Added `focusedId` state + `flatItems` flattened list + `handleTreeKeyDown` in `CollectionTree.tsx`. Keys: ↑↓ navigate, →← expand/collapse, Enter open/toggle, Delete prompt delete. Visual focus ring via `ring-1 ring-inset ring-accent/50`. Auto-scroll via `scrollIntoView`.

---

### P3-8 — Collection Runner Lacks Parallel Execution Mode ✅ FIXED (2026-05-22)

---

### P3-9 — SOAP Code Generator Leaves console.log in Generated Node.js Snippet ✅ FIXED (2026-05-23)

`soapClient.ts:549`: changed `console.log(res.statusCode, data)` → `console.log(data)` with a comment.

---

### P3-10 — Tab Restoration Silently Destroys All Tabs When Disabled ✅ FIXED (2026-05-23)

`SettingsPanel.tsx`: Toggle onChange for `restoreTabsOnStartup` now shows a `ConfirmDialog` ("Disable tab restoration?") before disabling. On confirm, calls `updateGeneral({ restoreTabsOnStartup: false })` + `useTabsStore.getState().save()` to clear persisted tabs immediately.

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
