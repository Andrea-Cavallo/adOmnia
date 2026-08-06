# Changelog

All notable changes to adOmnia are documented here.

This project follows a pragmatic release log format inspired by Keep a Changelog. Versions are created from Git tags such as `v0.1.0`; GitHub Actions builds the Windows, Linux, and macOS artifacts automatically.

## [0.6.9] - 2026-08-06

### Added
- **Extract JSON values into environment variables:** select a value in a JSON editor, right-click, and choose the adOmnia context-menu action to store it in the active environment and replace it with `{{VARIABLE_NAME}}`. Variable names are inferred from the enclosing JSON property and stay unique; a local Development environment is created only when needed.
- **Contextual header-value presets:** focusing a request header value now offers compatible choices for the selected header. Content-Type and Accept include common API media types such as JSON, XML, form data, multipart, Server-Sent Events, NDJSON, JSON:API, GraphQL, SOAP, YAML, CBOR, MessagePack, PDF, and binary payloads.
- **Expanded header preset catalog:** the Headers panel now groups and filters practical presets for content and encoding, authentication/API keys, cache and conditional requests, browser/CORS/proxy work, tracing, webhooks, GraphQL/SOAP, and PSD2/Berlin Group.
- **Request/Response layout switcher:** choose side-by-side panels or stack Request above Response. Both layout and independently resized panel dimensions are saved locally.
- **JavaScript script editor:** Pre-request, Post-response, and Tests now use a local Monaco editor with JavaScript syntax colors, line numbers, bracket matching, completion, and inline syntax errors with line and column details. The dynamic `pm.*` API does not produce false validation errors.
- **Interactive request-body JSON Graph:** nested nodes are joined by clear, colored arrowed connections. Matching `{ n }` references, destination nodes, and arrows share a depth color, and values can be edited inline directly from the graph.

### Changed
- **Coherent request workspace:** the request editor now has a matching `Request` header alongside `Response`, with the layout controls placed directly where they are needed.
- **Clearer empty response state:** the response pane now says "Ready for the response." while retaining the Ctrl+Enter send shortcut.

- **Readable request notes:** the Notes description editor now opens at a practical multi-line height and remains vertically resizable.
- **Monaco 0.56 compatibility:** OpenAPI and script editors now load all local editor workers through the current public Monaco entry points; the script editor is loaded only when its tab is opened.
- **Dependency maintenance:** upgraded `github.com/gabriel-vasile/mimetype` to 1.4.15, `github.com/gaissmai/bart` to 0.29.0, `github.com/rabbitmq/amqp091-go` to 1.13.0, and `monaco-editor` to 0.56.0.
- **Codebase cleanup:** removed obsolete assertion UI and unused client, demo, storage, mock, proxy, and binding paths so the shipped code follows the active product surface.

## [0.6.7] - 2026-07-31

### Fixed
- **Path template preservation:** changing only query parameters or a fragment in the resolved top request bar no longer replaces a `{pathParam}` template with its current literal value.
- **OpenAPI component schemas:** Contract validation now resolves local `$ref` component schemas, so Mock Server and response checks validate the common `#/components/schemas/...` shape correctly.
- **Mock collection isolation:** endpoints imported from another collection are no longer checked against the selected collection's OpenAPI contract.
- **MCP hydration race:** a slow local-storage read cannot overwrite a configuration edited while the MCP Control Room is opening.
- **Dependency security:** upgraded transitive `fast-uri` and `dompurify` versions; `npm audit --omit=dev` now reports zero vulnerabilities.

## [0.6.6] - 2026-07-31

### Added
- **Mock Server contract checks:** the Control Room now validates every active mock response against the selected collection's OpenAPI specification before consumers hit it. It reports undocumented status codes, Content-Type and required-header mismatches, and JSON-schema failures locally and inline.

### Changed
- **Single request URL synchronizer:** the composer and the top request bar now use the same URL update path. Editing a URL keeps query rows and path-parameter keys together, including parameter renames.
- **MCP desktop persistence:** saved MCP server configurations now hydrate from adOmnia's local bbolt storage. Existing browser-only configurations are copied forward automatically and remain available during the migration.
- **Release metadata alignment:** the application and frontend package now share version `0.6.6`.

### Fixed
- **Live path-parameter regression coverage:** URL templates, inline defaults, renamed placeholders, query rows, and rendered path values are covered by automated tests.
- **Path-param helper copy:** the Params panel hint no longer renders a broken text-encoding sequence.

## [0.6.5] - 2026-07-31

### Fixed
- **Live path parameters:** `{id:value}` is resolved as path key `id` with value `value`, and changing a Path Params value updates the visible request URL immediately.

## [0.6.0] - 2026-07-22

### Added
- **Swagger Editor workspace redesign:** the section now opens straight into a live editor/preview split (no landing card), powered by the Monaco editor with offline workers — syntax highlighting, folding, find/replace, format, cursor position, and inline error markers on the offending line.
- **Schema-aware OpenAPI IntelliSense:** completion and hover for YAML (`monaco-yaml`) and JSON (native) against the OpenAPI 3.0 meta-schema, plus `$ref` completion of the document's own component names.
- **Swagger preview parity (dark):** rendered markdown in descriptions with external links, an OpenAPI version badge (e.g. `OAS 3.2`), per-tag "Find out more" external-docs links, a switchable media-type dropdown for request/response bodies, JSON example syntax highlighting, and endpoint search/filter — all on the adOmnia design system.
- **Mock this tab in context:** opens the Mock Server on the Endpoints view with the chosen request selected and a focused request scope, applied live without changing the port or restarting.
- **Mock Server Control Room:** Overview / Endpoints / Traffic / Contract views, an endpoint explorer with inspect/edit, manual endpoint creation, and explicit (no longer automatic) collection import that preserves the source collection.
- **Mock traffic diagnostics:** each request shows the mock's decision (selected endpoint, chosen response, or error reason), rows link to the endpoint involved, and Clear now empties the backend log.
- **Live mock runtime updates:** a runtime configuration endpoint atomically swaps mock endpoints while the server runs (port stays fixed).
- **AI system-environment credentials:** a "Use system environment credentials" mode in Settings > AI Engine that bypasses the Vault entirely and reads the key only from the machine environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `HUGGINGFACE_API_KEY`/`HF_TOKEN`, `OPENAI_COMPATIBLE_API_KEY`, and the `ADOMNIA_AI_API_KEY` fallback).

### Changed
- **OpenAPI 3.2 QUERY:** the QUERY method is parsed and rendered as a first-class operation in the Swagger preview.
- Optional provenance metadata (`sourceCollectionId`, `sourceRequestId`) is stored on saved mock endpoints; existing configurations remain valid.

## [0.5.9] - 2026-07-19

### Added
- **Swagger Try it out to API Core:** API Docs operations now open directly in API Core collections for immediate request testing from the Swagger-style preview.
- **Pinned tab protection:** pinned request tabs are compact and cannot be closed by single close, close-left/right, close-all, or request deletion tab cleanup.
- **Modern desktop UI polish:** command palette/drop overlays, tab save feedback, resize handles, response diff flashes, network mini-timeline, and compact Raycast-style toasts now share a cohesive interaction layer.

## [0.5.8] - 2026-07-19

### Changed
- **Swagger Editor preview fidelity:** API Docs now renders operations closer to Swagger UI, with light preview styling, method-colored endpoint cards, visible parameters/request body/response sections, generated JSON examples from schemas, and a response table layout.

### Fixed
- **OpenAPI YAML fallback validation:** lenient YAML parsing now rejects structurally broken documents instead of silently treating them as valid specs.

## [0.5.7] - 2026-07-18

### Changed
- **Swagger Editor in API Core:** API Docs is now a Swagger Editor-style workspace with YAML/JSON editing, live preview, a split editor/preview layout, preview-only mode, adjustable pane width, and quick conversion between OpenAPI/Swagger specs and API Core collections.

## [0.5.6] - 2026-07-18

### Added
- **HTTP QUERY method support:** adOmnia now supports the new HTTP `QUERY` method standardized by RFC 10008. `QUERY` sits between `GET` and `POST`: it allows a complex read-only search to be sent in the request body while preserving safe and idempotent semantics.
- **QUERY across the API workspace:** `QUERY` is available in the request composer, top request bar, tab labels, collection tree, request import/export, API Docs parsing, HAR/browser debug views, load testing, Net Tools CORS checks, Mock Server endpoints, and generated client snippets.
- **QUERY-aware code generation:** generated examples now use generic request APIs where a language or library has no native `query()` helper, including Python `requests.request("QUERY", ...)`, C# `new HttpMethod("QUERY")`, Java OkHttp `builder.method("QUERY", body)`, Ruby `Net::HTTPGenericRequest`, and Rust `reqwest::Method::from_bytes`.
- **Mock Server QUERY examples:** mock presets and tab-to-mock actions can create `QUERY` endpoints with JSON search responses, and mock CORS headers advertise `QUERY`.

### Changed
- **Lean default product surface:** adOmnia now starts lighter around API Core, Protocols, Document Studio, and Power Tools, while heavier areas such as Browser Debug, Database Studio, and Git Sync are treated as advanced features.
- **API Core placement:** Mock Server and Proxy Interceptor now live under API Core so API authoring, mocking, and interception stay close together.
- **JSON Studio placement:** JSON Studio is promoted ahead of Notes/Markdown so JSON payload work is immediately available from the primary workspace.
- **URL input cleanup:** pasted API URLs are normalized by trimming surrounding spaces and removing line breaks/tabs that would otherwise produce malformed requests.

### Fixed
- **Release test fixture restored:** the collection contract freeze fixture is present again so backend collection filesystem tests can run during release checks.

### QUERY Usage Notes
Use `GET` when the request is simple and naturally fits in the URL:

```http
GET /transactions?status=COMPLETED&from=2026-01-01&limit=100
```

Use `QUERY` when the search is read-only but too complex for a query string:

```http
QUERY /transactions
Content-Type: application/json

{
  "statuses": ["COMPLETED", "PENDING"],
  "dateRange": {
    "from": "2026-01-01",
    "to": "2026-06-30"
  },
  "accountIds": ["ACC-100", "ACC-200", "ACC-300"],
  "sort": [
    {
      "field": "bookingDate",
      "direction": "DESC"
    }
  ]
}
```

`QUERY` is useful for advanced transaction searches, account movement filters, dynamic reporting, search engines, complex catalog filters, long identifier lists, nested `AND`/`OR` conditions, aggregations, grouping, SQL-like queries, or proprietary read-only DSLs.

Continue using `GET` for simple reads such as:

```http
GET /transactions/123
GET /transactions?status=PENDING&page=0&size=20
GET /accounts/456/balance
```

Do not use `QUERY` for commands or mutations:

```http
POST /payments
POST /transfers
POST /accounts/123/block
```

Rule of thumb: simple filter and reasonable URL -> `GET`; complex read-only search with body -> `QUERY`; creation or data mutation -> `POST`, `PUT`, or `PATCH`.

| Aspect | GET | QUERY |
| --- | --- | --- |
| Search data | URL/query string | Request body |
| Body semantics | Not defined | Expected and meaningful |
| Modifies data | No | No |
| Idempotent | Yes | Yes |
| Automatic retry | Safe | Safe |
| Bookmark/share URL | Yes | Not directly |
| Cache | Simple and widespread | Possible, but the cache key must include body and request metadata |

For `QUERY`, the body and its `Content-Type` formally define the search. Servers should reject requests with missing or inconsistent `Content-Type`. `QUERY` responses are formally cacheable, but caches must consider the request body and metadata, so support is more complex than for `GET`.

## [0.5.5] - 2026-07-17

### Added
- **Standalone JSON Studio:** the left rail now exposes a dedicated JSON workspace with Raw as the first/default view, formatted tree inspection, graph view, fullscreen mode, file/drop loading, search, copy, clear, minify, and persisted local session state.
- **Two-pane JSON comparison:** JSON Studio can open a second JSON document on the right, keep both panes fullscreen side by side, sort object keys A-Z, and show path-level differences.
- **Lossless JSON utilities:** JSON formatting, sorting, minifying, and diffing preserve long numeric tokens without rounding or rewriting their original spelling.
- **Feature Surface settings:** Settings now includes switches for advanced features, lab features, Plugins, and Daily Scenarios so the product surface can stay cleaner by default.

### Changed
- **Cleaner product taxonomy:** the rail is now driven by a central feature registry and grouped around API, Protocols, Infrastructure, Browser Debug, Local Data, Tools, Docs, and Workspace.
- **Command palette alignment:** the command palette now uses the same feature registry and respects advanced/lab visibility settings.
- **Focused Welcome hub:** the first screen now emphasizes API-first workflows and payload/document work instead of presenting every module with equal weight.
- **Document Studio cleanup:** advanced document tools can be hidden behind feature flags instead of crowding the primary rail.
- **Net Tools consolidation:** Net Tools now route through Browser Debug, keeping network inspection in one coherent workspace.
- **Power Tools split:** Base64, Hash, JWT, Password, and UUID utilities were moved into focused tool components with a shared utility registry.

### Removed
- **Duplicate legacy JSON Tools panel:** JSON workflows now live in the dedicated JSON Studio instead of the old Utils-embedded panel.
- **Public legacy rail aliases:** `jsontools`, `utils`, `nettools`, and `kafka` were removed from the active rail type surface; startup normalization still maps old saved values to the new destinations.

### Fixed
- **Browser-safe Wails fallbacks:** local preview can render the new frontend routes without crashing on missing desktop bindings.
- **Rail visibility regressions:** advanced/lab filtering is now applied consistently to the rail and command palette.

### Fixed
- **Reliable gRPC Studio execution:** load tests now classify the actual gRPC status instead of treating every HTTP 200 as success, and they carry metadata, TLS, custom CA, mTLS certificates, and request timeout settings into every invocation.
- **Honest descriptor and connection state:** imported proto/protoset descriptors remain available for offline request authoring without pretending a live server connection; changing endpoint, TLS, certificates, or profile invalidates the previous connection state.
- **Reproducible gRPC history:** call history now preserves and restores metadata, TLS/mTLS paths, and timeout settings for accurate reruns.
- **Safe request defaults:** new gRPC sessions no longer send demonstration authorization metadata automatically.

### Added
- **Live cancellable gRPC streaming:** server and bidirectional stream messages are delivered incrementally through the local sidecar, with an in-place Cancel action, configurable timeout, response headers, and trailers.

## [0.5.1] - 2026-06-27

### Added
- **Versionable collection folders:** collections can now be exported as deterministic, diff-friendly folders with stable metadata, folder/request JSON files, Windows-safe names, and a sync manifest. The importer reconstructs the collection tree from disk and round-trips the exported structure deterministically.
- **Collection folder workflow in Git Sync:** the Git Sync panel includes a `Collection Folder` section for exporting the selected collection, importing a folder-backed collection, and checking drift between the in-app collection and the folder projection.
- **Headless collection runner foundation:** the desktop executable now supports `adomnia run <collection-folder>` without opening the Wails UI. The runner imports folder-backed collections, executes supported HTTP requests through the Go transport, supports CLI/JSON reports, `--out`, `--bail`, `--env`, and `--env-var KEY=VALUE`.
- **CI-ready runner output:** the headless runner now supports `--folder` for focused folder runs and `--reporter junit` for pipeline-readable XML reports.
- **Shared request execution contract:** GUI and headless execution now share a stable request-resolution layer for variables, path params, query/header/body resolution, simple auth, and assertion evaluation.
- **OpenAPI governance lint engine:** added the local `internal/oaslint` engine with built-in rules for operation IDs, descriptions, response coverage, JSON response schemas, tags, security requirements, path naming, duplicate operation IDs, local ruleset overrides, and structured JSON/text reporting.
- **CI-ready OpenAPI lint CLI:** the desktop executable now supports `adomnia lint <openapi.json|openapi.yaml|collection-folder>` with `--ruleset`, `--reporter text|json`, `--out`, and `--fail-on-warn`, returning non-zero exit codes for blocking governance errors.
- **Collection and folder inheritance foundation:** folder-backed collections can now carry shared auth, headers, variables, and scripts, with a single resolver applying top-down inheritance to headless runner requests. Collection bearer auth, folder headers, request overrides, and disabled inherited headers are covered by backend tests.
- **Git-safe environment workflow:** the headless runner loads a collection-local `.env` with deterministic precedence below named environments and CLI overrides. The environment editor can mark an environment private; private environments stay in local bbolt storage and are excluded from collection-folder and workspace-file exports. Public secret variables are exported as empty placeholders, and stale environment files are removed when an environment becomes private.
- **OpenAPI governance in API Docs:** API Docs now includes an integrated Governance view powered by the same local lint engine as the CLI, with severity badges, searchable/filterable findings, local ruleset overrides, and navigation from a violation to its documented operation.
- **Advanced headless runtime parity:** `adomnia run` now supports non-interactive OAuth2 grants, AWS Signature v4, explicit Vault values from CI environment variables, a run-scoped cookie jar, multipart fields/file uploads, sandboxed pre/post/test scripts, and OpenAPI response-contract validation.
- **Single-request collection export:** Git Sync can update only the active request in an existing collection-folder projection, preserving its path and sequence so a request edit produces a one-file Git diff.

### Changed
- **Request sending now records a resolved request contract before transport:** the existing GUI send path still calls the same backend transport, but the resolved request shape is now explicit and covered by tests.

### Notes
- Interactive OAuth authorization-code/PKCE remains a desktop browser flow. Headless automation uses client credentials, password, or refresh-token grants, and injects Vault-backed values through explicit process environment variables without exposing ciphertext or plaintext in reports.

## [0.4.8] - 2026-06-25

### Added
- **Save a response value as an environment variable:** right-click any value in the response Body (or a Headers value) and choose *Save as environment variable…* — pick the name (the JSON key is suggested automatically) and the target environment. Perfect for capturing a token from a getToken-style response straight into `{{access_token}}`. A *Copy value* action is included in the same menu.

### Changed
- **System titlebar is now the real default:** existing installs that still carried the legacy in-app titlebar are migrated to the native system titlebar on launch (explicit choices are preserved). New installs already defaulted to it.

### Fixed
- **Welcome hub search hint readability:** the "Press Ctrl/Cmd + F to search any feature" badge was nearly invisible on the light theme — it now uses theme-aware contrast.
- **PSD2 / Berlin Group header presets visibility:** the quick-add presets area is taller so the Berlin Group section is no longer hidden below the Common headers.

## [0.4.7] - 2026-06-25

### Added
- **PSD2 / Berlin Group header presets:** the request Headers tab now offers the NextGenPSD2 (XS2A) standard headers — `Consent-ID`, `PSU-ID`, `PSU-IP-Address`, `TPP-Redirect-URI`, `Digest`, `Signature`, `TPP-Signature-Certificate`, `Aspsp-Sca-Approach`, and more — as one-click chips, grouped separately from the common headers.

### Changed
- **Environments & Hosts moved into the sidebar (more vertical room):** the Env and Hosts switchers no longer sit in a strip above the request — they live in the left sidebar under the Workspace selector, right above Collections. Switching, adding, renaming, and editing environments/hosts all happen from there. The request method + URL bar now sits higher, giving the Body/Response area more space.
- **Workspace name in the panel header:** the API Workspace header shows the active workspace name (live — rename it in the sidebar and the header updates) instead of a static "API Workspace" label.
- **Clearer header presets and labels:** preset chips that share a value (e.g. `application/json` for both Accept and Content-Type) now show the full `Header: value` so they are no longer ambiguous duplicates, and the Headers tab columns read **Header name / Header value** for consistency with the Cookies tab.

### Added
- **GitHub host integration (Pull Requests):** connect with a Personal Access Token, list open pull requests for the origin repository, and open a PR from the current branch — without leaving adOmnia. Available in the Git "Actions" tab.
- **Multi-host Git collaboration accounts:** save multiple GitHub, GitLab, Bitbucket, and Azure DevOps identities, auto-select them from the repository remote, and protect access tokens with local Vault references. Self-hosted API base URLs are supported.
- **AI pull request drafts:** generate a reviewable PR title and Markdown description from the actual base-to-branch diff using the AI provider configured in adOmnia.
- **Repository terminal:** run shell and Git commands with the active repository as CWD, inspect output and exit status, and refresh the Git graph/status immediately after every command.

### Changed
- **Request editor hierarchy:** primary request sections now use full active tabs, body examples use selectable tab-cards with rename/duplicate/delete actions, and payload formats use a distinct segmented control with clearer labels and keyboard focus states.

## [0.4.6] - 2026-06-25

### Added
- **Cancel in-flight requests:** while a request is running the **Send** button turns into a red **Cancel** button, so a slow or hung request can be aborted immediately. Cancellation is wired end-to-end — the Go backend registers each request by id and aborts the underlying connection (both the native HTTP path and the browser-fetch upload path). Cancelled requests report a clean `CANCELED` status instead of a misleading error.
- **Close All tabs:** new **Close All** action in the tab context menu, alongside Close / Close to the Right / Close to the Left. Honors the unsaved-changes confirmation dialog.
- **Create an environment straight from the URL bar:** right-clicking an `{{variable}}` token in the URL when no environment exists now creates one on the spot and opens the inline value editor, so the variable can be given a value without leaving the request.

### Changed
- **Collapsible API Tools bar (cleaner, more minimal layout):** the API Tools row (Follow redirects, Load test, Timeout, URL Encode, Query String, Import cURL, HTTP Status) is now hidden by default and toggled with a small control next to **Send**. Collapsing it gives the Body/Response area more vertical room; the open/closed state is remembered between sessions.

### Removed
- **Settings → Features section:** removed the non-functional "Plugins (experimental)" and "Daily Scenarios (experimental)" toggles and their navigation entry.

### Notes
- adOmnia has request timeouts: a per-request **Timeout (ms)** field (`0` = no timeout) plus a global default in **Settings → Requests**. Requests exceeding the timeout fail with a `TIMEOUT` status — the same model used by Postman/Bruno.

## [0.4.0] - 2026-06-20

### Added
- **Git client overhaul — professional, single-repo workflow now substantially complete (34/40 GitKraken-class features):**
  - Granular staging: separate Staged/Unstaged sections, per-file and per-hunk/per-line stage/unstage, and partial commits (`CommitPaths`).
  - Full branch management: checkout of local and remote (tracking) branches, delete local/remote, and set-upstream.
  - Complete stash workflow: apply/show/drop per stash entry plus stash of selected files only.
  - Three-way conflict editor: Base/Ours/Theirs side by side with an editable merged result, saved and staged in-app.
  - Generic undo via reflog: restore to an earlier recovery point (soft/mixed/hard) beyond the last commit.
  - Visual blame and file history: per-line gutter and a navigable per-revision diff timeline.
  - AI assistance on staged changes, working changes, and branch level (commit message generation, explanation, risk scan).
  - Named Git profiles with per-host auto-switch, plus persistent repo/branch pins.
  - Advanced repository support: worktrees, submodules, and sparse checkout with UI.
  - Virtualized/lazy commit graph and extended drag & drop (branch→branch, commit→branch, file→stage).
  - Azure DevOps deep-links (commit/compare) for HTTPS, SSH `v3`, and Visual Studio hosts.
- Advanced HTTP load-test workflows in the Composer drawer: named scenarios, persisted results, baseline comparisons, and Markdown/HTML reports.
- gRPC load testing directly from gRPC Studio.
- Full bbolt snapshot export/restore and legacy localStorage migration controls in Storage Explorer.
- Active-session administration for WebSocket and SSE clients, plus configurable Proxy breakpoint patterns.
- Backend-powered RFC 6902 JSON patches and X.509 certificate inspection in Power Tools.

### Fixed
- `Push`/`Pull` no longer fall back to a hardcoded `main`/`master` when no branch is passed: the checked-out branch is resolved via `symbolic-ref`, with an explicit error on detached HEAD.
- `git status --porcelain` parsing no longer corrupts the first entry (column-0 space is preserved).

### Removed
- Orphaned Scheduler frontend bindings and the misleading RabbitMQ exchange-info endpoint, which only performed a connection check.

## [0.2.2] - 2026-06-14

### Added
- **PDF Editor** panel: view, annotate (free text, highlight, shapes, ink), fill
  AcroForm fields, place a visible signature, and export a flattened PDF. Projects
  are re-editable and persisted locally (bbolt). Open via drag-drop, file picker, or
  the "Open in PDF Editor" action on `application/pdf` API responses.
- **Cryptographic PDF signing** with `digitorus/pdfsign` (real ByteRange/CMS
  signatures), including signature verification from the toolbar.
- **Enterprise signing tier:**
  - Import **PKCS#12 (`.p12`/`.pfx`) and JKS** keystores directly in the signing
    dialog (pure-Go, no `keytool`/`openssl`); the private key is extracted in the
    backend and never reaches the frontend.
  - **Inspect certificate** before signing — shows subject, issuer, validity, and
    chain length without exposing the private key.
  - **RFC 3161 timestamping** via a configurable TSA URL (optional basic auth; URL
    can be remembered, credentials never stored).
  - **Long-term validation (LTV)** — embeds the certificate chain plus OCSP/CRL
    revocation data into the document DSS.
- Read-only **API Docs / Swagger viewer** (OpenAPI 3 and Swagger 2.0).
- GitHub Actions desktop artifact pipeline for Windows, Linux, and macOS.
- Layered hub layout for the main desktop workspace.
- Runtime support for request scripts and test/post-response execution.

### Changed
- Improved Markdown layout and Git diff workflow.
- README download instructions now point users to GitHub Releases and Actions artifacts.

### Fixed
- OpenAPI import now also accepts PDF-sourced specs.
- Linux Docker artifact export no longer creates a container from a scratch image.

### Out of scope
- PKCS#11 / HSM / smart-card signing (requires native OS drivers; conflicts with the
  single portable executable) and PAdES B-LTA archive-timestamp refresh.

## [0.1.0] - unreleased

Initial public packaging target.

### Included
- Wails 2 desktop shell with Go backend and React/TypeScript frontend.
- API workspace, environments, scripts, assertions, response viewer, and import tooling.
- SOAP, gRPC, WebSocket/SSE, brokers, mock server, proxy, browser debugging, database tools, vault, and utilities.
