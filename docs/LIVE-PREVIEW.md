# Web development in the IDE: Live Preview, web languages and Go Live

Open a static site, a React/Vite app or a Node.js project in Code Studio, edit it, and see the real page next to the code, without VS Code, an external browser or extra tools. Everything Code Studio already does for Go (trust model, terminals, Run console, Git, gopls, Delve) is unchanged.

This page is the technical reference. For the platform rules read [`architecture/ide-multilanguage-refactor.md`](architecture/ide-multilanguage-refactor.md) and [`internal/ide/CLAUDE.md`](../internal/ide/CLAUDE.md).

---

## What you get

| Piece | What it does |
|---|---|
| **Web languages** | JavaScript/TypeScript (JSX, TSX), HTML, CSS/SCSS/Less and JSON, each with its standard language server. |
| **Project detection** | `package.json` projects (npm, pnpm, yarn, bun, monorepo apps) and static sites (`index.html`). Detecting never runs anything. |
| **Go Live** | One click (status bar, `Alt+L`, ▶ Run in a web-only project, *Open with Live Preview* on an HTML file) starts the right server and shows the page. |
| **Live Preview** | A real page in an isolated frame with Back / Forward / Reload, auto reload, address bar, responsive viewport, console / network / build problems. |
| **Placements** | Split with the editor (default), tab next to the files, tool window panel, or a separate native window. The choice is remembered per project. |

---

## Using it

1. **Open the folder** (File → Open Project) and trust it. An untrusted project never starts a server or a script; the preview panel asks for trust first.
2. **Go Live.** adOmnia picks what to run:
   * a `package.json` with a `dev` (else `start`, `serve`, `develop`) script → that script with the project's package manager (lockfile / `packageManager` field decide: npm, pnpm, yarn, bun);
   * an `index.html` and no dev script → adOmnia's own static server with live reload;
   * several candidates (monorepo, or no remembered choice) → a short list to choose from.
3. **Edit.** CSS changes swap in without reloading the page; HTML/JS changes reload it. For Vite/Next/… the project's own HMR / Fast Refresh does the work, and component state survives when the framework allows it.
4. **Stop / Restart** from the toolbar or the status bar (`Live · :5173`). Stopping frees the port and every child process.

If something is missing the panel says so instead of failing silently:

| Situation | What you see |
|---|---|
| Node.js / the package manager not found | the problem and the ways to fix it (install LTS, `corepack enable`, restart adOmnia) |
| Dependencies not installed | the exact install command, asked for confirmation (`npm ci`, `pnpm install --frozen-lockfile`, … when a lockfile exists, so it is not rewritten) |
| Port in use | the dev server moves to the next free port; adOmnia reads the real URL from its output |
| Dev server exits / never answers | a plain explanation and a button for the Run console |
| Compile error | Vite's overlay in the page, plus *Build problems* in the console drawer: click to open the file at that line |
| Language server not installed | a one-line notice above the editor; Monaco's built-in features keep working. *Install…* asks first |

### Commands

| Command | Where |
|---|---|
| Go Live (Live Preview) — `Alt+L` | Run menu, status bar |
| Stop / Restart Live Preview | Run menu, toolbar |
| Open Current HTML File with Live Preview | Run menu; right-click an HTML file in Project |
| Live Preview: Split / Tab / Panel / Window | View menu, toolbar |
| Open in a Window / External Browser | toolbar, status bar menu |
| Install Web Language Servers… | Tools menu |

---

## Architecture

```
internal/languages/web/     Web ADAPTER: language adapters (typescript, html, css, json), project
                            detection (package.json units, static sites), package manager and script
                            detection, Node runtime detection, language-server locator + ServerSpec
internal/ide/preview/       Live Server CORE (language-agnostic): static server, dev-server proxy,
                            URL scanner, readiness probe, Manager (lifecycle, sessions, processes)
internal/codestudio/service_web.go   HOST wiring: trust, authorized paths, saved configuration, events
code_studio_web_bindings.go           Wails bindings (thin)
internal/codestudiowindow/preview.go Native preview windows

frontend/src/components/ide/languages/web/   language contributions, Emmet, Monaco fallback
frontend/src/components/code-studio/CodeStudio*Preview*.tsx   Live Preview UI
frontend/src/stores/livePreview.ts · ideWebServers.ts · lib/code-studio/livePreview.ts
```

The dependency direction is the platform's: host → core ← adapter. The core never imports `internal/languages/web`; `internal/ide/architecture_test.go` enforces it.

### Language servers

* Four adapters, one language server each (`typescript` serves JS/TS/JSX/TSX): `typescript-language-server`, `vscode-html-language-server`, `vscode-css-language-server`, `vscode-json-language-server`. They use the platform's generic LSP manager: one server per language and session, lifecycle, crash recovery, idle hibernation and shutdown are the same as gopls'.
* A server starts **only** when a file of its language is opened in a trusted project, and only if it exists. Lookup order: `node_modules/.bin` of the project (and its parents, for monorepos), adOmnia's own tools folder, `PATH`.
* *Install…* runs `npm install --prefix <tools>/node typescript-language-server typescript@^6 vscode-langservers-extracted`: always after confirmation, output in the Run console, never inside the user's project. TypeScript stays below 7 because `typescript-language-server` runs `lib/tsserver.js`, which the TypeScript 7 package no longer ships.
* JSON validates `package.json` against a bundled schema; **schema download is disabled** (local-first).
* Monaco ships JS/TS, HTML, CSS and JSON services. Without a server they are the fallback (JSX/TSX parse, unresolved imports are not flagged because Monaco cannot see `node_modules`). When the server is ready it replaces them **for the lifetime of the editor** (`useWebMonaco`), so completions, hovers and diagnostics are not duplicated; Monaco's settings are global and the API-script editor shares them, hence the scoped hold/release.
* Features tuned on gopls (semantic colours, inlay hints, Code Vision) stay Go-only (`heavyFeatures: false` on the web contributions).
* Emmet (`emmet` npm package, lazy-loaded) completes abbreviations in HTML, CSS/SCSS/Less and JSX/TSX.

### Live Server

Two modes behind one `Manager` (`internal/ide/preview`), keyed by session and preview id. Each preview belongs to a session; closing it, revoking trust or quitting the app stops everything it owns.

**Static server** (`StaticServer`)
* Binds `127.0.0.1` only, on a stable per-folder port (5500–5899, next free if busy) so `localStorage` survives restarts.
* Serves only inside the authorised folder: path cleaning, no hidden segments (`.git`, `.env`, `.adomnia`), symlinks resolved and re-checked against the root, `Host` header check (DNS-rebinding), GET/HEAD only, `Cache-Control: no-store`.
* The reload client is injected **in memory** into HTML responses (top of `<head>`, so early errors are seen). Files on disk are never modified.
* Live reload rides on the existing project file watcher (`files.changed`: debounced, gitignore-aware, `node_modules`/`dist`/`build` excluded): CSS-only batches swap stylesheets, anything else reloads. No extra watchers, no polling.

**Dev server** (`StartDevServer`)
* Runs the project's own script through the existing `ProcessManager` (`Kind: devserver`, so stdout/stderr land in the Run console, with Stop/Rerun). Arguments are explicit, never a shell: `npm run dev -- --host 127.0.0.1`, `pnpm run dev --host 127.0.0.1`, …
* Loopback is enforced without breaking unknown scripts: `--host 127.0.0.1` / `-H 127.0.0.1` only for simple scripts of Vite and Next; `HOST=127.0.0.1`, `BROWSER=none`, `PORT=<free>` in the environment for the rest. Composite scripts (`&&`, `concurrently`, …) receive no extra flags.
* Readiness is real: the URL is read from the output (ANSI stripped, `Local:` line preferred, `0.0.0.0` mapped to loopback), then probed with HTTP until the server answers. A port change (Vite moving to 5174) is followed.
* A **bridge proxy** (`ProxyServer`) exposes the dev server on its own loopback port and injects the same bridge client. It lets the toolbar reload / go back / go forward, reports console and runtime errors, and makes the preview work when the dev server forbids framing (`X-Frame-Options`, `frame-ancestors` are removed for the preview only). HMR WebSockets pass through unchanged; redirects are rewritten; the `Host` sent upstream is the dev server's own. If the proxy cannot start the preview still works, directly, with fewer controls (`bridged: false`).
* One dev server per preview id: pressing Go Live again reuses it.
* Children: stopped as a tree; also registered in the managed-children registry, so on Windows a crash of adOmnia kills them (job object) and on Unix the next start sweeps them.

### Frame, bridge and what is *not* a debugger

The page is shown in an isolated iframe (`sandbox` without `allow-top-navigation`): navigating inside it can never reload the adOmnia UI. The bridge (`live.js`) talks to the IDE with `postMessage`: navigation, `console.*`, runtime errors, failed assets, `fetch`/XHR status. It is not a second browser-debugging engine: breakpoints, DOM inspector and the full CDP integration are **not available in the embedded WebView**, and the console drawer says so. Use *Open in a window* or the external browser for DevTools. The existing Browser Debug panel is untouched.

### Trust, security, performance

* Untrusted project → no script, no server, no install, no language server (`Authorization == AuthorizationPermitted` is checked in `StartPreview`, `InstallWebDependencies`, `InstallWebTools`, `StartWebLanguageServer`).
* Installing dependencies or tools is always an explicit, confirmed action showing the exact command. `package.json` and lockfiles are never edited by adOmnia (frozen-lockfile installs when a lockfile exists).
* Servers bind loopback only; nothing is exposed on the LAN.
* Idle cost is zero: no timers or polling while no preview runs; language servers hibernate when idle like gopls.

### Persistence

`PreviewConfigs` in the Code Studio state (key: normalised real path of the project): mode, folder, script, entry page, SPA fallback, placement, device, viewport, auto reload. Optional field, no schema bump; nothing is written into the project.

---

## Files

New:

* `internal/languages/web/` — `language.go`, `detect.go`, `projectinfo.go`, `runtime.go`, `servers.go`, `schemas/package.schema.json`, tests
* `internal/ide/preview/` — `hub.go`, `static.go`, `proxy.go`, `net.go`, `output.go`, `manager.go`, `live.js`, tests
* `internal/codestudio/service_web.go` (+ test), `internal/codestudiowindow/preview.go`, `code_studio_web_bindings.go`
* `frontend/src/components/code-studio/CodeStudioLivePreview.tsx`, `CodeStudioPreviewFrame.tsx`, `CodeStudioPreviewSetup.tsx`, `CodeStudioPreviewDrawer.tsx`, `CodeStudioPreviewSplit.tsx`, `CodeStudioPreviewStatus.tsx`, `CodeStudioWebServerNotice.tsx`, `codeStudioPreviewCommands.ts`
* `frontend/src/components/ide/languages/web/` — `index.ts`, `commands.ts`, `emmet.ts`, `useWebMonaco.ts`
* `frontend/src/stores/livePreview.ts`, `ideWebServers.ts`; `frontend/src/lib/livepreview-api.ts`, `lib/code-studio/livePreview.ts`

Changed (small, surgical): `internal/codestudio/{languages,service,persistence,extensions}.go`, `code_studio_bindings.go`, the editor / tabs / tool stripes / run panel / status bar / project tree menu / command registry / LSP sync and language-feature providers in `frontend/src/components/code-studio/`, `components/ide/languages.ts`, `stores/codeStudioLsp.ts` (`'preview'` tool window), `lib/monacoSetup.ts` (CSS and HTML workers), `tsconfig.json` (types path for `emmet`), generated bindings.

---

## Verification

Automated:

```bash
go test ./internal/ide/... ./internal/languages/... ./internal/codestudio/ ./internal/codestudiowindow/
go test ./internal/ide/ -run 'Architecture|CoreDoesNot|AdaptersDo|BackgroundProcesses'
# frontend (from frontend/)
npx tsc --noEmit
npx vitest run src/lib/code-studio/livePreview.test.ts src/components/ide src/components/code-studio src/stores
```

The Go tests start real servers and a real `npm run dev` process tree (skipped without npm) and check that ports and children are gone after Stop, session close, trust revocation and shutdown.

Manual / desktop (done against the real Windows app through the WebView2 CDP port, see `reference_e2e_real_app` notes): static site CSS hot swap and HTML reload; React + Vite via npm with Fast Refresh keeping state; pnpm project; monorepo chooser; SPA route + reload; Node missing; busy 5173; compile error overlay + clickable build problems; untrusted project; reopen restores placement/viewport; tab, native window and tablet viewport; tsserver installed from the notice with real diagnostics; Go project and mixed Go + web project unchanged. **Still to check by hand on macOS and Linux**: WebKitGTK/WKWebView framing of `http://127.0.0.1`, native preview windows, and `pnpm`/`yarn`/`bun` quirks on those platforms.

---

## Completed and known limits

Completed (P0 + P1): web languages and standard LSP servers with lifecycle/recovery; project import and detection (npm/pnpm/yarn/bun, monorepos, static sites, Node/PM detection, confirmation before install, saved configuration); static Live Server and framework dev servers with real readiness, HMR/Fast Refresh, busy ports, console, stop/restart, tree cleanup; Live Preview in split/tab/panel/window with responsive viewport; status-bar Go Live, context command, clickable build errors; console, runtime errors, network status and failed assets through the bridge (a slice of P2).

Limits:

* ESLint and Prettier are not wired as separate servers: formatting comes from the language servers, and ESLint runs through the project's own scripts.
* No CDP: no breakpoints, DOM inspector or source-map-based stack traces in the embedded WebView (see above). Node.js `--inspect` debugging is a later phase.
* One preview is shown at a time per project. The manager and the ids already support several; the UI does not expose them yet.
* Dev servers other than Vite/Next/CRA/Angular/Astro/Nuxt/webpack get only environment hints (`PORT`, `HOST`); if one ignores them and listens on all interfaces, adOmnia still only exposes it through its own loopback proxy.
* Proxy: pages larger than 16 MB are not enriched; a dev server that gzips HTML cannot be enriched either (adOmnia asks for identity encoding, which all current dev servers honour).
* The user's own `pnpm-workspace.yaml` in a parent folder (e.g. the home directory) makes pnpm treat unrelated projects as workspace members; this is pnpm behaviour, not adOmnia's.
