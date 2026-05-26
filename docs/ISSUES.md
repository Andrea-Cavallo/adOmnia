# adOmnia — Issues & Missing Features
*Perspective: a developer who uses adOmnia daily as their primary API tool.*
*Date: 2026-05-25 — branch: master*

---

## How to read this document

Every issue is written from the POV of a **real user hitting the problem** during their workday. Severity levels:

| Badge | Meaning |
|-------|---------|
| 🔴 **P0 — Blocker** | Stops core workflow. Must fix before wider adoption. |
| 🟠 **P1 — High** | Significant friction every day. Strong candidate for next sprint. |
| 🟡 **P2 — Medium** | Annoyance. Degrades quality but has a workaround. |
| 🔵 **P3 — Polish** | No workaround needed, but makes the product feel unfinished. |

---

## P0 — Blockers

### ✅ P0-01 · Flow Builder is non-functional for real multi-step workflows

**User story:**
> I spend 20 minutes wiring up a 6-step auth → fetch → assert → extract → use-token → cleanup flow. I save it. I reopen adOmnia the next day. My flow is gone, or steps are back to defaults. I can't trust the tool for regression scenarios.

**What's been fixed:**
- Runtime state (`status`, `durationMs`, `error`, etc.) is now stored separately from the persisted step definition in `stepRuntime: Record<string, FlowStepRuntime>`.
- Persistence moved to bbolt via `flowStorage.ts` (`saveFlowDefinitions`/`loadFlowDefinitions`) with legacy localStorage migration.
- Flow export format updated to `{ format: 'adomnia-flow', version: 2, definition, lastRun }`.
- Steps survive app restart with all fields intact.

**Still pending:** Condition, Wait, and Script step types need end-to-end testing; flow execution UX could be improved.

---

### ✅ P0-02 · Large workspaces silently corrupt or fail to save

**User story:**
> I import a company Postman collection — 400 requests, 8 environments, 300+ variable definitions. Everything loads fine. I add 20 more requests over a week. One morning I open adOmnia and half the collection is missing. No error was ever shown.

**What's broken:**
`adomnia.v2` is stored in `localStorage`. Browsers/WebViews enforce a 5–10 MB per-origin limit. When the limit is exceeded, `localStorage.setItem` throws a `QuotaExceededError` that is silently swallowed if not caught. The app never warns the user that persistence failed.

**Seen in code:** `CLAUDE.md` explicitly flags: *"localStorage size limits (≈5-10MB) — large workspaces may hit this."*

**Impact:** Real data loss with no user-visible warning. Trust-breaking.

**What's been fixed:**
- `safeLocalStorage.ts` — wrapper centralizzato che cattura `QuotaExceededError` / `NS_ERROR_DOM_QUOTA_REACHED`.
  Dispara `adomnia:save-error` (StatusBar toast 5s) + `adomnia:storage-quota-exceeded` (banner persistente).
- `StorageQuotaBanner.tsx` — banner ambrato non-auto-dismissible posizionato sotto la titlebar.
  Include link diretto a Workspace → Export; persiste in `sessionStorage` tra hot-reload.
- Tutti i 20+ `localStorage.setItem` sparsi nel frontend sostituiti con `safeSetItem()`.
- Le store principali (collections, environments, tabs, settings, hosts) erano già su bbolt — nessuna regressione.

---

### ✅ P0-03 · PanelHeader "Close" always navigates to Collections — wrong context

**User story:**
> I'm in the Mock Server panel. I click ✕ to close the panel and go back to what I was doing. Instead of returning to the Proxy panel I came from, I land in API Collections. Every time. I have to re-navigate manually.

**What's been fixed:**
- `app.ts` now maintains a `railHistory: RailItem[]` stack (last 20 entries) and a `goBack()` method.
- `MainArea.tsx` close button now calls `goBack()` when history exists, falling back to `collections` only when there's no history.
- Alt+← keyboard shortcut also calls `goBack()`.
- Back button in `PanelHeader` is disabled when history is empty.

---

### ✅ P0-04 · No Command Palette — discoverability and speed are broken

**User story:**
> I know adOmnia has a CORS tester somewhere in Network Tools. I can't remember which sub-panel. I spend 90 seconds clicking through the rail icons trying to find it. In Raycast, Linear or JetBrains I'd press ⌘K and type "cors". Here I'm hunting.

**What's been fixed:**
- `CommandPalette.tsx` — full command palette dialog with keyboard navigation.
- `commandPalette.ts` — 42 panel entries across all adOmnia modules, with search keywords.
- `Ctrl+K` / `Cmd+K` opens a searchable command palette (replacing the old import dialog binding).
- Palette includes: panel navigation (all 40+ rail items), recent requests, environments, collections, and actions (New Request, Start Mock, Start Proxy, Settings).
- Fuzzy search with instant results, group headers, keyboard shortcuts footer.

---

## P1 — High Priority

### ✅ P1-01 · gRPC streaming (client/server/bidi) shows a "warning badge" but does nothing

**User story:**
> I connect to our streaming gRPC service. I select a server-streaming method. I get a badge saying "streaming not supported — unary only". The tool is useless for that whole API surface. I switch back to grpcurl.

**What's been fixed:**
- `/grpc/invoke` now executes server-streaming, client-streaming and bidirectional methods through reflected dynamic descriptors, as well as unary calls.
- The gRPC panel accepts an ordered JSONL sequence for client and bidi streams and sends each message on the actual stream.
- Bidirectional responses are received while outgoing messages are sent, then rendered as a streamed result list with status and timing.
- TLS and metadata behavior remain available across unary and streaming calls.

---

### ✅ P1-02 · Response body has no search / highlight

**User story:**
> I get a 2,000-line JSON response. I need to find every occurrence of `"userId": "abc-123"`. There is no Ctrl+F, no highlight, no "find in response" field. I have to copy-paste into a text editor.

**What's been fixed:**
- `ResponsePanel` now provides an inline find bar with `Ctrl/Cmd+F`, case-insensitive highlight, match counter, and next/previous navigation.
- JSON matches remain syntax-highlighted and support full expressions spanning tokens, such as `"userId": "abc-123"`.
- Graph view retains its dedicated key/value search instead of displaying an incompatible text-match count.

---

### P1-03 · OAuth 2.0 flow requires manual copy-paste of authorization code

**User story:**
> I configure OAuth 2.0 for our staging API. I click "Get Token". Nothing happens in-app. I have to open a browser, copy the auth code, paste it back, and manually complete the exchange. Postman opens an embedded browser window and does this automatically.

**What's broken:**
The OAuth2 auth config (`AuthEditor.tsx`) stores `grantType`, `tokenUrl`, `authUrl`, etc. but there is no in-app browser or redirect URI handler to complete the Authorization Code flow automatically.

---

### ✅ P1-04 · Import only covers Postman v2.1 — Insomnia, Bruno, OpenAPI full-round-trip missing

**User story:**
> I have 3 years of Insomnia collections. I try to import. There is no Insomnia option. I try the OpenAPI 3.0 import — it works for simple operations, but all my custom auth, pre-request scripts, and folder descriptions are stripped.

**What's been improved:**
- **Insomnia v4 importer** now maps auth methods (bearer, basic, apikey, oauth2), query parameters, urlencoded/multipart body types, and pre/post-request scripts via `importInsomniaAuth()`.
- **Bruno `.bru` native file parser** (`parseBruFile()`) auto-detects `.bru` text format: parses meta, method, URL, headers, query params, auth (bearer/basic/apikey), body (json/xml/text/form/multipart), and pre/post scripts. Also improved JSON Bruno export import with auth support.
- **OpenAPI importer** now resolves server URL variables (`resolveServerUrl()`), maps per-operation `security` requirements (with global fallback), and supports OAuth2/openIdConnect schemes via `schemeToAuth()`.

**Still pending:** OpenAPI custom `x-` extensions are not preserved. Full round-trip export back to OpenAPI is not implemented.

---

### ✅ P1-05 · Environment variables have no secret masking in the editor

**What's been fixed:**
- `EnvVariable.type` field supports `'text' | 'secret'`.
- In `EnvModal.tsx` each variable row shows an Eye/EyeOff toggle; secret variables render as `type="password"` inputs.
- Import JSON preserves the `type` field; export round-trips correctly.

---

### P1-06 · Proxy / Interceptor: CA certificate export is incomplete

**User story:**
> I start the proxy to intercept HTTPS traffic from my mobile device. I need to install the CA certificate on the device. The UI says "Export CA" — I click it — I get a .pem file. I try to install it on iOS. It fails. The PEM contains only the cert, not the full chain, and the format is wrong for mobile trust-store import.

**What's broken:**
CLAUDE.md flags: *"HTTPS interception CA export incomplete (TODO)."* The proxy does generate per-host certs, but the CA export flow has known issues.

---

### P1-07 · Tab state is lost when switching between tool panels

**User story:**
> I have 5 request tabs open. I navigate to the Mock Server panel to check a hit log. I go back to API Collections. All my tabs are still there — good. But the active tab is reset to the first one. My scroll position in the response body is also gone.

**What's broken:**
`setActiveRail` in `app.ts` switches the view but the `TabBar`/`MainArea` does not preserve per-rail UI state (active tab index within the collection, scroll offsets). Each rail navigation is effectively a remount.

---

### P1-08 · No persistent cookie jar / session manager

**User story:**
> I log in via POST /auth/login, get a `Set-Cookie: session=xyz`. I send GET /me — it fails because the cookie isn't automatically attached. I have to manually copy the cookie value and add it as a header. Every request. Postman has a cookie jar. Insomnia has one.

**What's missing:**
There is a setting `G1.24 Invia cookie automaticamente` and `G1.25 Preserva cookie tra tab` in the settings schema, but there is no visible cookie jar UI where the user can inspect, edit, or delete persisted cookies per domain.

---

## P2 — Medium Priority

### P2-01 · Collections sidebar has no full-text search across request bodies/headers

**User story:**
> I vaguely remember writing a request that POSTed to `/users/batch`. I search in the sidebar. The search only matches request names. I have to open each request individually. With 200+ requests in a collection, this is painful.

---

### ✅ P2-02 · JSON response viewer collapses all nodes on every re-send

**User story:**
> I expand a deeply nested JSON tree: `data → items → 0 → metadata → tags`. I tweak my request and resend. The entire tree collapses back to root. I re-expand manually every time.

**What's been fixed:**
- `JsonGraph` accepts controlled expansion state from `ResponsePanel`.
- Expanded JSON paths now remain open when the response is resent or the user toggles between graph and pretty views.

---

### ✅ P2-03 · No "duplicate request" or "clone to new tab" action

**User story:**
> I want to compare two variations of the same request side by side. There is no way to duplicate a tab with all its config — headers, auth, body, params. I have to rebuild from scratch.

**What's been fixed:**
- `duplicateTab(id)` added to the tabs store — deep-copies the request with a fresh ID and `(Copy)` suffix on the name, inserts the new tab immediately after the original, and activates it.
- TabBar context menu (right-click on any tab) now shows **Duplicate** as the first item.
- `Ctrl+D` keyboard shortcut duplicates the active tab when the Collections rail is open.

---

### ✅ P2-04 · Mock Server hit log has no filter / search

**What's been fixed:**
- Path search input (case-insensitive substring match on the path column).
- Method filter pills: ALL / GET / POST / PUT / PATCH / DELETE.
- Match filter pills: All / OK (matched) / MISS (unmatched).
- Counter shows `filtered/total` when a filter is active; "no hits match" empty state.
- All filters are combined; up to 200 filtered entries shown (was hardcoded 100).

---

### ✅ P2-05 · Load Test results are not persisted after app restart

**User story:**
> I run a 10-minute load test on Friday. I close the app. Monday I want to compare those numbers against a new run. The results are gone. There is a "Save Scenario" feature but it saves the configuration, not the results.

**What's been fixed:**
- Four new backend endpoints in `loadtest.go`: `POST /loadtest/result/save`, `GET /loadtest/result/list`, `GET /loadtest/result/load`, `DELETE /loadtest/result/delete`.
- Results stored in bbolt under `workspace / ltresult/<name>` — persists across restarts.
- `LoadTestPanel.tsx` shows a **Save Result** card below Compare, with a name input. After saving, a **Saved Results** `<details>` list appears showing all runs with name, method/URL, date, avg/p95/error-rate stats.
- Each saved result row has **Load** (restore as current result), **Baseline** (load for Compare), and **Delete** actions.

---

### ✅ P2-06 · Dark/light theme toggle is buried in Settings — no quick access

**What's been fixed:**
- Sun/Moon icon button added to the right side of the status bar — one click to toggle.
- `Ctrl+Shift+L` keyboard shortcut toggles dark ↔ light.
- Toggle prefers a same-family opposite theme (e.g., `builtin-dark` ↔ `builtin-light`) before falling back to any available opposite-mode theme.

---

### ✅ P2-07 · No diff view between two responses (compare mode)

**User story:**
> I send the same request to staging and production. I want to see a visual diff of the two JSON responses. HAR Viewer has a compare mode (`D2.14`) but only for pre-loaded HAR files. There is no live response compare.

**What's been fixed:**
- `DiffView.tsx` — new file with `computeLineDiff` (LCS-based, fallback above 4M cells), `DiffModal`, and `DiffPickerModal`.
- Clicking `GitCompare` in any ResponsePanel opens **DiffPickerModal** with two modes:
  - **Open Tabs** — lists all other tabs that have a response (method, name, status, latency); click any row to compare instantly.
  - **Paste Text** — textarea for pasting an external body.
- **DiffModal**: LCS side-by-side diff, line numbers, "Diff only" toggle (hides unchanged with `…N…` separators), prev/next diff (`n`/`p` keys), summary badge (+N/−N/~N). JSON auto-pretty-printed before diff.
- Removed old primitive `DiffModal` + `Prompt`-based flow from `ResponsePanel.tsx`.

---

### P2-08 · SOAP Studio: WS-Security only supports UsernameToken — no X.509 / Signature

**User story:**
> Our bank's SOAP API uses WS-Security with X.509 certificate-based digital signatures. adOmnia only supports username/password. I have to sign the envelope manually and paste it. The "enterprise-first" claim falls short here.

**What's broken:**
`B2.6` documents only `UsernameToken`. X.509 signing, timestamp tokens, and encrypted assertions are absent.

---

### P2-09 · GraphQL: no persisted query variables or schema introspection result caching

**User story:**
> I open the GraphQL body editor. I run introspection — it fetches the schema fine. I close the tab and reopen. The schema is gone. I run introspection again. Every session. For a 500-type schema this takes 5 seconds.

---

### P2-10 · Browser Debug panel: no way to filter network requests by XHR / Fetch only

**User story:**
> I open the Browser Debug network monitor. The page loads 300 requests — CSS, fonts, images, analytics pixels. I want to see only the API calls. There is a filter panel (`D1.3`) but it doesn't have a "XHR/Fetch only" quick toggle like Chrome DevTools does.

---

### P2-11 · Keyboard shortcuts are incomplete and not consistently discoverable

**User story:**
> I look at the Settings → Keyboard Shortcuts section to learn what's available. I see 5 shortcuts. Most of the 30+ panels have no documented shortcuts. There is no way to add custom shortcuts.

**What's broken:**
`G2.10` documents only 5 keyboard shortcuts. SOUL.md requires *"every action has a keyboard shortcut."* The gap between aspiration and reality is wide.

---

### P2-12 · No "Request History" panel — only per-tab response history

**User story:**
> I sent a request 3 days ago that returned the user data I need as a reference. I remember roughly what the endpoint was. There is no global request history I can search. Each tab only keeps recent responses for that specific tab (`A1.9`), and only while the app is open.

---

## P3 — Polish

### P3-01 · Inconsistent panel header heights and spacings

**User story:**
> The Mock Server panel header is 32px. The Proxy panel header is 40px. The SOAP Studio header has no back button. The gRPC panel header has a different font weight. These are all noticeably different when switching quickly.

---

### P3-02 · Welcome / Hub screen has no "recently opened" section

**User story:**
> I use 3 different workspace files for 3 clients. Every morning I open adOmnia and manually navigate to Workspace → Load to pick the right one. A "Recent Workspaces" section on the home screen would save 30 seconds every day.

---

### ✅ P3-03 · Status bar shows mock/proxy running state but no quick toggle

**What's been fixed:**
- Status bar now subscribes to `mockRunning` and `proxyRunning` from the app store.
- When Mock or Proxy is running, an animated pulse badge appears in the status bar.
- Clicking the Mock badge navigates directly to the Mock Server panel; clicking Proxy navigates to the Proxy Interceptor panel.

---

### P3-04 · HAR Viewer: import from Proxy requires navigating to HAR panel

**User story:**
> I'm in the Proxy panel looking at traffic. I want to run HAR analysis on it. I have to: (1) export from Proxy as HAR, (2) navigate to HAR Viewer, (3) import file. A direct "Open in HAR Viewer" button on the Proxy panel would collapse this to one click.

---

### ✅ P3-05 · The Onboarding/Welcome panel does not update to reflect actual workspace state

**User story:**
> The WelcomePanel shows static stats like `REST / http core` and `04 protocols`. These are hardcoded strings, not live data from my actual workspace. After 6 months of use, the welcome screen still looks like I just installed the app.

**What's been fixed:**
- `WelcomePanel.tsx` now subscribes to the collection, environment, tab and app runtime stores.
- The hero metrics display live collection, request, environment and running-service totals.
- Layer statistics now reflect open tabs, active environment, saved responses and current Mock / Proxy / Browser Debug activity.
- The footer reports which local services are active; product guarantees such as zero telemetry remain intentional static messaging.

---

### P3-06 · No visual indicator when a request tab has unsaved changes

**User story:**
> I modify a request — change the URL, add a header. Nothing tells me I haven't saved it to the collection. I navigate away and lose the change. The `A1.14` feature says there is a "dirty-state indicator" but the dot/indicator is too subtle to notice.

---

### P3-07 · Tooltip coverage is sparse — many icon-only buttons have no tooltip

**User story:**
> In the Proxy panel toolbar there are 5 icon-only buttons. I hover over them. Three have no tooltip. I have to click to discover what they do. In a dense developer tool, every icon button must have a tooltip.

---

### P3-08 · The Vault panel and the Environment editor are isolated — no bridge

**User story:**
> I store `PROD_DB_PASSWORD` in the Vault. I want to use it in an environment variable so it automatically substitutes into `{{PROD_DB_PASSWORD}}` in requests. There is no UI to link a Vault secret to an environment variable.

**What's missing:**
`E4` documents the Vault and `E1.18` mentions Vault integration for DB connections. But the bridge between Vault → Environment variable substitution is not wired up in the UI.

---

### P3-09 · Code generation (`A1.10`) does not reflect current auth configuration

**User story:**
> I have a request with AWS Signature v4 auth. I click "Generate Code". The Python snippet has no auth. The JavaScript snippet has no auth. The snippets only include URL, method, and body — not the computed Authorization header.

---

### P3-10 · Settings panel does not have a search / filter

**User story:**
> The Settings panel has 8+ sections and 55 individual settings. I want to find the "Max redirect" setting quickly. There is no search box at the top of the Settings panel.

---

### P3-11 · No request-level notes / documentation field

**User story:**
> I want to add a note to a request: "This endpoint only works Monday–Friday 09:00–17:00 UTC (batch window). Auth token expires after 1h." There is no description or notes field on a request item.

---

### ✅ P3-12 · Broker Studio (Kafka/MQTT/etc.) — connection presets are per-session

**User story:**
> I configure my Kafka cluster connection (3 brokers, SASL, TLS). I restart adOmnia. I have to re-enter everything. Broker connection configs should be saved and restored like DB connections in Database Studio.

**What's been fixed:**
- Connection configuration is now persisted locally in bbolt through `StorageGet` / `StoragePut`, using the dedicated `broker_connections` bucket.
- Each protocol restores its latest configuration automatically after restart: Kafka, RabbitMQ, MQTT, Redis and NATS.
- `ConnectionProfiles.tsx` adds named profiles with save, load and delete controls, separate from message-body presets.
- Kafka persistence includes brokers, topic, consumer group, client ID, TLS and SASL credentials/mechanism.
- Writes are serialized so autosave cannot overwrite a simultaneous named-profile save or deletion.
- The UI explicitly states that credentials stay local and points users to Vault for managed secret reuse.

---

## Summary Table

| # | Title | Priority | Area |
|---|-------|----------|------|
| ✅ P0-01 | Flow Builder persistence separated from runtime | 🔴 P0 | Flows |
| ✅ P0-02 | Large workspaces silently corrupt | 🔴 P0 | Storage |
| ✅ P0-03 | PanelHeader close → always Collections | 🔴 P0 | UX/Navigation |
| ✅ P0-04 | No Command Palette | 🔴 P0 | UX |
| ✅ P1-01 | gRPC unary and streaming invocation | 🟠 P1 | gRPC |
| ✅ P1-02 | Response body search and highlight | 🟠 P1 | HTTP Client |
| P1-03 | OAuth 2.0: manual code paste required | 🟠 P1 | Auth |
| ✅ P1-04 | Import: added Insomnia/Bruno/improved OpenAPI | 🟠 P1 | Import |
| ✅ P1-05 | Env vars: secret masking with Eye/EyeOff toggle | 🟠 P1 | Security |
| P1-06 | Proxy CA export broken on mobile | 🟠 P1 | Proxy |
| P1-07 | Scroll/tab state lost on panel switch | 🟠 P1 | UX |
| P1-08 | No persistent cookie jar UI | 🟠 P1 | HTTP Client |
| P2-01 | Collection search: name only, not body | 🟡 P2 | Collections |
| ✅ P2-02 | Preserve JSON tree expansion on re-send | 🟡 P2 | Response |
| ✅ P2-03 | Duplicate/clone to new tab | 🟡 P2 | UX |
| ✅ P2-04 | Mock hit log: path search + method + match filters | 🟡 P2 | Mock |
| ✅ P2-05 | Load test results persisted to bbolt | 🟡 P2 | Load Test |
| ✅ P2-06 | Theme toggle: status bar button + Ctrl+Shift+L | 🟡 P2 | UX |
| ✅ P2-07 | LCS diff + tab picker compare mode | 🟡 P2 | Response |
| P2-08 | SOAP: no X.509 WS-Security | 🟡 P2 | SOAP |
| P2-09 | GraphQL schema not cached | 🟡 P2 | GraphQL |
| P2-10 | Browser Debug: no XHR-only filter | 🟡 P2 | Browser Debug |
| P2-11 | Keyboard shortcuts incomplete | 🟡 P2 | UX |
| P2-12 | No global request history | 🟡 P2 | History |
| P3-01 | Inconsistent panel header sizes | 🔵 P3 | Visual |
| P3-02 | Welcome screen: no recent workspaces | 🔵 P3 | UX |
| ✅ P3-03 | Status bar: mock/proxy badges + clickable nav | 🔵 P3 | UX |
| P3-04 | Proxy → HAR requires 3 steps | 🔵 P3 | UX |
| ✅ P3-05 | Welcome panel: live workspace and service stats | 🔵 P3 | UX |
| P3-06 | Unsaved-change indicator too subtle | 🔵 P3 | UX |
| P3-07 | Icon buttons missing tooltips | 🔵 P3 | Accessibility |
| P3-08 | Vault ↔ Environment: no bridge | 🔵 P3 | Integration |
| P3-09 | Code gen ignores auth | 🔵 P3 | Code Gen |
| P3-10 | Settings: no search | 🔵 P3 | UX |
| P3-11 | No request notes/documentation field | 🔵 P3 | Collections |
| ✅ P3-12 | Broker connection presets persisted locally | 🔵 P3 | Broker Studio |

---

## Suggested Fix Order (Product-First Sprint)

### Sprint 1 — Stop the bleeding
1. ~~**P0-03** — Fix close button to use `goBack()`~~ ✅ DONE
2. ~~**P0-01** — Stabilise Flow Builder persistence~~ ✅ DONE
3. ~~**P0-04** — Basic Command Palette~~ ✅ DONE
4. ~~**P0-02** — Catch localStorage quota errors + add migration to bbolt~~ ✅ DONE
5. **P1-07** — Preserve rail scroll/tab state across navigation

### Sprint 2 — Core workflow completeness
6. ~~**P1-04** — Insomnia/Bruno/OpenAPI import improvements~~ ✅ DONE
7. ~~**P1-02** — Response body search/highlight~~ ✅ DONE
8. **P1-08** — Cookie jar: at minimum a visible per-domain cookie inspector
9. ~~**P2-04** — Mock hit log filtering~~ ✅ DONE
10. ~~**P2-02** — Preserve JSON tree expansion state across re-sends~~ ✅ DONE
11. ~~**P1-05** — Env var secret masking~~ ✅ DONE
12. ~~**P2-06** — Theme quick toggle (status bar + Ctrl+Shift+L)~~ ✅ DONE
13. ~~**P3-03** — Status bar mock/proxy clickable nav~~ ✅ DONE
14. ~~**P2-03** — Duplicate/clone request to new tab (Ctrl+D + context menu)~~ ✅ DONE
15. ~~**P2-05** — Load Test results persisted to bbolt (save/load/delete)~~ ✅ DONE
16. ~~**P2-07** — Live response diff/compare (LCS diff, tab picker, DiffPickerModal)~~ ✅ DONE

### Sprint 3 — Differentiators & enterprise
11. **P1-03** — OAuth 2.0 in-app browser for Authorization Code flow
12. **P1-06** — Fix proxy CA export for mobile (PEM + DER + iOS instructions)
13. ~~**P1-01** — gRPC server/client/bidirectional streaming~~ ✅ DONE
14. **P2-08** — SOAP X.509 WS-Security signing
15. **P3-08** — Vault ↔ Environment variable bridge

---

## New Issues Found (Audit 2026-05-26)

### 🟠 N01 — Global file drop: Bruno `.bru` files are not routed to the importer

**File:** `frontend/src/lib/globalFileRouter.ts:38`

**What's broken:**
The `routeGlobalDropFile()` function matches `.json`, `.yaml`, `.yml`, `.adomnia` extensions but has no case for `.bru`. The `collectionTransfer.ts` importer now has a full `parseBruFile()` parser, but dropping a `.bru` file shows "Unsupported file" instead of importing it.

**Fix:** Add `.bru` to the extension regex on line 38 (or a dedicated branch before it).

---

### 🟡 N02 — Kafka load test overshoots message count by `concurrency - 1`

**File:** `kafka.go:330-335`

**What's broken:**
In `kafkaLoadTestHandler`, `sequence.Add(1)` atomically increments before checking `idx >= req.TotalMsgs`. Since each goroutine increments-then-checks, every worker can produce one extra message before noticing it has reached the limit. Total overshoot: up to `concurrency - 1` messages.

**Fix:** Move the check before the increment, or check a shared atomic stop flag set by an external counter goroutine.

---

### 🔵 N03 — JSON bracket nesting colors lost in Win95 theme

**File:** `themes_extended.go:1004-1006`

**What's broken:**
`json-bracket-1`, `json-bracket-2`, `json-bracket-3` all changed from distinct colors (`#8B6914`, `#007777`, `#8B008B`) to `#000000`. All bracket depth levels now render identically, losing visual nesting information when reading deeply nested JSON.

---

### Extra features implemented (not in original ISSUES.md)

| # | Feature | Area |
|---|---------|------|
| E-01 | **Kafka Producer Load Test** — Concurrent producers with HDR histogram latency (avg/P50/P95/P99), throughput timeline chart, ramp-up, duration or count mode | Kafka |
| E-02 | **Global File Router** — Drag-and-drop auto-detects .har → HAR Viewer, .wsdl → SOAP Studio, .class → Class Inspector, collections → import | Import/UX |
| E-03 | **Java Class Inspector v2** — Full class structure parsing → Java source skeleton reconstruction (package, class, fields, methods with JVM descriptor decoding) + raw details mode | Power Tools |
| E-04 | **Build Info** — App version, build date, commit hash injected at build-time via Vite `define` | Dev/UX |
| E-05 | **JSON Design Tokens** — `--json-key`, `--json-string`, `--json-number`, `--json-bool`, `--json-null` CSS custom properties for theme-aware syntax highlighting | Visual |

---

*Generated by: AI analysis + simulated real-user audit*
*Last updated: 2026-05-26 — 17 of 36 original issues resolved, 5 extra features added, 3 new issues found*
