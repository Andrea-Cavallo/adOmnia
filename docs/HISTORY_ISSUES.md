# adOmnia - Resolved Issues History
*Archived from `docs/ISSUES.md` on 2026-05-26.*

This file records issues already addressed. Active work belongs in [`ISSUES.md`](./ISSUES.md).

## Resolved Original Issues

| # | Resolution | Priority | Area |
|---|------------|----------|------|
| P0-01 | Flow definitions persist separately from runtime and execute multi-step workflows. | P0 | Flows |
| P0-02 | Storage writes report quota failures and primary stores use bbolt persistence. | P0 | Storage |
| P0-03 | Panel close/back navigation uses rail history and `Alt+Left`. | P0 | UX/Navigation |
| P0-04 | Command palette supports global panel and action navigation. | P0 | UX |
| P1-01 | gRPC supports unary, server-streaming, client-streaming and bidirectional calls. | P1 | gRPC |
| P1-02 | Response viewer includes search, highlight and navigation. | P1 | HTTP Client |
| P1-03 | OAuth 2.0 Authorization Code + PKCE runs through a secure loopback flow. | P1 | Auth |
| P1-04 | Insomnia/Bruno import and OpenAPI import/export round-trip support were implemented. | P1 | Import |
| P1-05 | Environment secrets support masking and round-trip import/export. | P1 | Security |
| P1-06 | Proxy CA exports PEM and DER/CRT formats with install guidance. | P1 | Proxy |
| P1-07 | Request tab view state survives switching between tool panels. | P1 | UX |
| P2-02 | JSON graph expansion remains stable across resends and view switches. | P2 | Response |
| P2-03 | Requests can be duplicated into a new tab from context menu or shortcut. | P2 | UX |
| P2-04 | Mock hit log supports path, method and match filters. | P2 | Mock |
| P2-05 | Load test results persist in bbolt and can be reloaded or compared. | P2 | Load Test |
| P2-06 | Theme switching is accessible from the status bar and keyboard. | P2 | UX |
| P2-07 | Live response comparison uses a side-by-side diff and tab picker. | P2 | Response |
| P2-10 | Browser Debug exposes XHR/API request filtering. | P2 | Browser Debug |
| P2-12 | A searchable local Request History panel reopens captured requests. | P2 | History |
| P3-01 | Routed tools use consistent shared headers and toolbars. | P3 | Visual |
| P3-02 | Welcome shows recent local workspaces with one-click reopen. | P3 | UX |
| P3-03 | Status bar indicators navigate to running Mock and Proxy panels. | P3 | UX |
| P3-04 | Proxy traffic can be opened directly in HAR Viewer. | P3 | UX |
| P3-05 | Welcome metrics reflect live workspace and service state. | P3 | UX |
| P3-09 | Code generation includes effective authentication headers. | P3 | Code Gen |
| P3-10 | Settings can be searched by field labels and descriptions. | P3 | UX |
| P3-11 | Requests support persisted Notes/documentation. | P3 | Collections |
| P3-12 | Broker connection presets persist locally across restarts. | P3 | Broker Studio |
| P1-08 | Session cookie jar captures Set-Cookie, replays by domain/path, visible in Composer. | P1 | HTTP Client |
| P2-01 | Sidebar search inspects headers, params, body, notes; match hint badge shown on results. | P2 | Collections |
| P3-06 | Tab dirty dot is now warning-orange with pulse animation and tooltip; Save button highlights amber when there are unsaved changes. | P3 | UX |
| P3-07 | All icon-only close/delete/action buttons across Composer, KVEditor, ApiToolsBar, CollectionTree, ResponsePanel, HarViewer, and DiffView now carry `title` tooltips. | P3 | Accessibility |
| P2-08 | SOAP Studio WS-Security expanded to UsernameToken (Text/Digest), Timestamp, and X.509/RSA-SHA256 signature via Exclusive C14N + Web Crypto API. | P2 | SOAP |

## Notable Resolution Notes

### P1-07 - Request tab state retention

- The tabs store retains session-only view state per request tab alongside persisted `activeTabId`.
- Returning to API Collections restores Composer section and scroll state, Response tab/mode and scroll state, and JSON graph expansion.
- Closing tabs removes their transient view-state entries; viewport positions are not written into persisted workspace data.

### P2-12 - Searchable Request History

- The dedicated `Request History` panel is available from API Core, the status bar, Welcome and the command palette.
- New entries persist a local request snapshot, timestamp and response, with search and reopening into a new request tab.
- Older response-only entries are retained as viewable legacy records because no request metadata existed for reopening.
- The Settings privacy action clears the same bbolt-backed history as the panel.

## Resolved Audit Findings

### N01 - Bruno `.bru` files were not routed by global file drop

`.bru` files are now routed to collection import and parsed through the native Bruno import path instead of being rejected as unsupported.

### N02 - Fixed-count Kafka load-test reservations could exceed the requested total

- The prior check already prevented extra Kafka sends, so the audit's stated published-message overshoot did not occur.
- Concurrent workers could still advance the internal reservation sequence beyond `TotalMsgs`.
- Fixed-count mode now reserves indices through a bounded atomic compare-and-swap helper.
- A concurrent Go regression test verifies exact in-range allocation under contention.

## Extra Delivered Features

| # | Feature | Area |
|---|---------|------|
| E-01 | Kafka Producer Load Test with latency percentiles, throughput chart, ramp-up, duration/count modes and bounded reservations. | Kafka |
| E-02 | Global File Router for HAR, WSDL, Java class and collection/workspace formats, including Bruno routing. | Import/UX |
| E-03 | Java Class Inspector v2 with source skeleton reconstruction and raw detail mode. | Power Tools |
| E-04 | Build information surfaced from Vite-injected app version, date and commit hash. | Dev/UX |
| E-05 | JSON design tokens for theme-aware syntax highlighting. | Visual |
| E-06 | Realtime malformed JSON diagnostics with line and column feedback. | HTTP Client/JSON |
| E-07 | Kafka Workbench producer/consumer workflow with local broker configuration and Vault handoff. | Kafka/UX |

---

*Archived: 2026-05-26 - 30 original issues resolved, 2 audit findings resolved, 7 extra features recorded.*
*Updated: 2026-05-26 - P2-08, P3-06, P3-07 resolved (33 total).*
