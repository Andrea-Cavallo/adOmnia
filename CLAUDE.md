# CLAUDE.md

Guidance for Claude Code when working in this repository.

---

## PRODUCT-FIRST PHILOSOPHY (PRIMARY DIRECTIVE)

**adOmnia is a production-grade desktop developer toolbox. This is NOT a theoretical exercise, a code challenge, or a boilerplate.**

The *primary goal* is a **professional, coherent, modern, and truly usable FINAL desktop PRODUCT**. Every decision must prioritize end-user experience and overall application quality.

### What We Are NOT Aiming For
- ❌ Perfect unit tests or excessively high code coverage
- ❌ Premature micro-optimizations
- ❌ "Academic" clean architecture at the expense of agility
- ❌ Isolated demos or proof-of-concepts

### Priority Hierarchy

| 🔴 HIGH PRIORITY (Product) | 🟢 LOW PRIORITY (Internal) |
|:----------------------------|:---------------------------|
| User Experience (UX) | Excessive, unnecessary unit tests |
| Real-world Integration | Premature abstractions |
| Fluidity & Responsiveness | Artificial layering (e.g. 900 layers) |
| Graphical Cohesion | Over-engineering solutions |
| Complete Workflows | |
| Perceived Stability | |
| User Journey | |
| Evolutionary Architecture | |
| Real Backend/Frontend Connection | |

**Rule:** when in doubt, bias toward what the user sees and touches. Internal code quality matters only insofar as it enables a better product.

---

## Current Project Status (HONEST ASSESSMENT)

Agents must understand the *real, current state* of the project:

- **Current runtime is Wails 2 + Go backend + React 18/TypeScript frontend.**
- Some older notes may still mention Tauri/Rust or legacy paths; verify against the current files before acting.
- **Backend is significantly more advanced** than the frontend
- **Frontend is still incomplete and nascent**
- **Many backend features are not yet connected** to the frontend
- **The UI is not yet professional** — lacks visual cohesion
- **Many modules still resemble mocks or prototypes**
- **Some features are technically functional but do NOT yet deliver a final product experience**

**Implication:** the highest-impact work is closing the frontend/backend gap, achieving visual cohesion, and elevating the UI to production quality — NOT adding more backend features in isolation.

---

## Canonical Project Context

Use these files as the fastest way to understand adOmnia before changing behavior:

| File | Purpose |
|------|---------|
| `docs/SOUL.md` | Product soul, UX philosophy, visual/product expectations, and long-term direction. Read this for any UX, theme, workflow, or product-quality decision. |
| `docs/funzionalita.md` | Complete feature inventory. Read this when you need to quickly understand all project capabilities or avoid duplicating an existing tool. |
| `docs/ROADMAP.md` | Roadmap and completion status across product areas. |
| `docs/ISSUES.md` | Current open issues, bugs, and active work queue. |
| `README.md` | Public product positioning and quick-start overview. |
| `AGENTS.md` | Practical operating guide for AI agents in this repo. |

**Rule:** when a task mentions an area you do not know well, search the code and check `docs/funzionalita.md`. When a task affects user experience, product feel, or visual cohesion, check `docs/SOUL.md`.

---

## Project Identity

**adOmnia** is a desktop API development toolbox built around four defensible pillars:

1. **Local-First** — no cloud, no accounts, no telemetry. Data never leaves your machine.
2. **User-Extensible** — plugin system, importable skins, shareable templates, versionable workspaces.
3. **Browser Debugging Integrated** — debug web pages inside the API tool (no competitor does this).
4. **Enterprise & Legacy First-Class** — SOAP, WSDL, WS-Security, mTLS, JKS, eIDAS, Berlin Group.

**Tech stack:** React 18 + TypeScript + Vite frontend, Wails 2 desktop shell, Go backend.  
**Distribution:** Single portable executable. No installation, no external dependencies at runtime.  
**Philosophy:** Local-first, privacy-first, user-extensible.

---

## Build and Run

### Development

```bash
# Install dependencies
cd frontend
npm install
cd ..

# Start dev server with hot reload
wails dev
```

### Production Build

```bash
# Windows
.\build.ps1

# macOS / Linux
./build.sh
```

---

## Directory Structure

The current repo is Wails/Go at the root with the React app under `frontend/`. If you see old `src-tauri/` references, treat them as historical and verify against the real files.

```
adomnia/
├── main.go                    # Wails entrypoint
├── app.go                     # App lifecycle and bindings
├── server.go                  # Local HTTP sidecar
├── mock.go                    # Mock server
├── proxy*.go                  # Proxy/interceptor stack
├── browser_debug*.go          # Chrome DevTools Protocol integration
├── kafka.go / broker.go       # Kafka and multi-broker support
├── grpc.go                    # gRPC backend
├── loadtest.go                # Load testing engine
├── database_go.go             # Database Studio
├── dockerlab.go               # Docker Lab generator/runner
├── themes*.go                 # Theme and skin system
├── plugins*.go                # WASM plugin sandbox
├── frontend/                  # React frontend
│   ├── src/components/        # UI panels and components
│   ├── src/stores/            # Zustand stores
│   ├── src/lib/               # API wrappers, parsers, helpers, types
│   └── src/styles/            # Global CSS and design tokens
├── assets/images/             # App artwork and icons
├── docker/adomnia-lab/        # Local lab Docker Compose setup
├── workspaces/                # Sample .adomnia workspaces
├── docs/                      # Documentation
│   ├── BUILD.md
│   ├── SOUL.md
│   ├── ISSUES.md
│   ├── funzionalita.md
│   └── ROADMAP.md
├── AGENTS.md                  # Detailed agent guidance (architecture, patterns)
├── CLAUDE.md                  # This file
├── README.md                  # User-facing overview
├── go.mod                     # Go dependencies
├── wails.json                 # Wails configuration
└── frontend/package.json      # Frontend dependencies
```

---

## Architecture

### Frontend (React 18 + TypeScript)

| Component | Purpose |
|-----------|---------|
| `App.tsx` | Root component, state owner, tab management, keyboard shortcuts |
| `Sidebar.tsx` | Collection tree, folder/request CRUD, search, context menus |
| `Composer.tsx` | Method + URL bar, body/headers/auth/scripts editors |
| `ResponsePanel.tsx` | HTTP response viewer, syntax highlighting, tests, history |
| `EnvBar.tsx` | Environment switcher, variable editor |
| `TabBar.tsx` | Tab management, pinning, context menus |
| `WSPanel.tsx` | WebSocket client with live messaging |
| `KafkaPanel.tsx` | Kafka producer/consumer UI |
| `MockPanel.tsx` | Mock server endpoint config, hit log |
| `ProxyPanel.tsx` | Interceptor traffic viewer, breakpoints, map local/remote |
| `LoadTestDrawer.tsx` | Load test config, scatter plot, percentile metrics |
| `UtilsPanel.tsx` | 20+ developer utilities (UUID, Base64, JWT, etc.) |
| `SettingsPanel.tsx` | Settings UI with sections (General, Appearance, etc.) |

**Storage:** localStorage-based persistence with versioned schema (`adomnia.v2`, `adomnia.settings`, `adomnia.mock`).  
**State management:** React hooks (useState, useEffect, useReducer where needed).  
**Variable substitution:** `{{varName}}` resolved from active environment before send.

### Backend (Wails 2 + Go)

The Go backend exposes Wails-bound methods consumed through generated bindings in `frontend/wailsjs/go/main/*`. Prefer existing frontend wrappers in `frontend/src/lib/*-api.ts` when they exist.

| Area | Files / bindings |
|------|------------------|
| App lifecycle/settings | `app.go`, `settings_bindings.go`, `frontend/wailsjs/go/main/App.*` |
| HTTP/mock/proxy | `mock.go`, `proxy*.go`, `httputil.go`, `record_replay.go` |
| Browser debugging | `browser_debug*.go` |
| Protocols/brokers | `grpc.go`, `kafka.go`, `broker.go`, `websocket_*.go`, `sse_client.go` |
| Data/security | `database_go.go`, `storage*.go`, `vault.go`, `certtools_go.go` |
| Docker Lab | `dockerlab.go`, `frontend/src/lib/dockerlab-api.ts` |
| Customization | `themes*.go`, `plugins*.go`, `templates.go` |

**IPC:** Frontend calls backend through Wails generated bindings.  
**CORS:** Desktop backend has system/network access; do not add unsafe browser-side workarounds.  
**Persistence:** Use the existing storage owner for the module: Zustand/localStorage, bbolt, settings bindings, or `.adomnia` workspace files.

---

## Key Patterns

### Four Pillar Implementation

#### 1. Local-First
- All data stored locally: bbolt, settings files, localStorage where still used, or exported `.adomnia` files
- No network calls except user-initiated API requests
- Workspace import/export is file-based
- No telemetry, no analytics, no cloud sync

#### 2. User-Extensible
- Plugin system architecture lives in `plugins*.go`, `frontend/src/components/plugins/`, and workspace plugin examples
- Workspace templates as JSON (sharable via git/email)
- Pre/post scripts with `pm.*` API compatibility
- Settings fully exposed and exportable

#### 3. Browser Debugging Integration
- Wails desktop app integrates browser debugging through Chrome DevTools Protocol helpers
- Network panel captures both API and browser traffic
- DOM inspector planned via DevTools integration
- Console access via JavaScript execution in page context

#### 4. Enterprise & Legacy
- SOAP envelope templates with WS-Security
- WSDL import and auto-generation (in progress)
- mTLS with PEM/JKS support (in progress)
- Custom auth flows (AWS4, Digest, OAuth2 PKCE)
- No header restrictions (unlike browsers)

### State Management

```typescript
// Immutable updates
setState(s => ({ ...s, key: value }))

// Storage persistence
useEffect(() => {
  localStorage.setItem('adomnia.v2', JSON.stringify(state))
}, [state])

// Load on mount
useEffect(() => {
  const stored = localStorage.getItem('adomnia.v2')
  if (stored) setState(JSON.parse(stored))
}, [])
```

### Variable Substitution

```typescript
// Before send
const url = substVars(request.url, activeEnv.variables)
const headers = request.headers.map(h => ({
  ...h,
  value: substVars(h.value, activeEnv.variables)
}))
```

### Auth Flow

```typescript
// OAuth2 auto-refresh
if (request.auth.type === 'oauth2' && isTokenExpired(request.auth)) {
  await refreshToken(request.auth)
}

// AWS Signature v4
if (request.auth.type === 'aws4') {
  const signature = computeAWS4(request, request.auth)
  request.headers.push({ key: 'Authorization', value: signature })
}
```

---

## Storage Keys

| Key | Contents |
|-----|----------|
| `adomnia.v2` | Main app state: collections, environments, tabs, history |
| `adomnia.settings` | Settings (versioned schema) |
| `adomnia.mock` | Mock server config |
| `adomnia.respHistory` | Response history (size-limited) |
| bbolt `flows/all` | Saved flow definitions; runtime results stay session-only |

---

## Workspace Format

`.adomnia` export schema:

```json
{
  "format": "adomnia-workspace",
  "version": "1.0",
  "collections": [],
  "environments": [],
  "activeEnvId": "",
  "mockConfig": {},
  "proxyConfig": {},
  "flows": []
}
```

**Backward compatibility:** Always migrate old schemas in loader functions.  
**Git-friendly:** Pretty-printed JSON, stable key order.

---

## Coding Conventions

### React/TypeScript

- Functional components with hooks
- Explicit prop types (no `any`)
- Immutable state updates
- Extract reusable logic into custom hooks
- Keep components focused: split when >300 lines
- Use existing icon components (`Icon.*`) where possible

### Go/Wails

- Keep Wails-bound methods small and delegate complex logic to local helpers/services
- Validate inputs before system calls, process launches, filesystem access, or network calls
- Use `context.WithTimeout` for network operations and long-running processes
- Return clean errors the frontend can show without raw terminal output
- On Windows, hide backend-launched CLI processes when they are not intentionally interactive

### CSS/UI

- Use CSS custom properties from `frontend/src/styles/globals.css` (`--color-*`, `--font-*`, radius, spacing, shadow)
- Keep styles modular, close to components
- Maintain dense, professional developer tool aesthetic
- No new external CSS frameworks. Tailwind is already part of this frontend; use the existing setup and design tokens.
- **Every panel must look like part of the same application** — not a collage of prototypes
- **Dimensional consistency:** same spacing, same font sizes, same interaction patterns
- **Immediate visual feedback:** every action needs perceptible feedback (hover, active, loading, success, error)
- **No "cheap" UI:** no misaligned borders, no off-palette colors, no inconsistent spacing
- **Wails/WebKitGTK cross-platform cohesion:** treat every user-visible WebKitGTK rendering difference on Linux as a product-quality issue, not as a secondary technical detail. Prefer global token-based normalization for recurring issues in `frontend/src/styles/globals.css`; use local workarounds only when the affected component is truly isolated. In particular, Linux can render native form controls with a light system appearance inside dark themes: for `select`, `input`, `textarea`, checkbox/radio, and number inputs, keep `color-scheme`, rely on the global normalizations, use `surface/text/border/accent/status` tokens, and avoid hardcoded Tailwind palette colors in primary UI (`bg-white/*`, `text-purple-*`, `bg-green-*`, etc.) unless they are intentional semantic states.

---

## Common Change Recipes

### Add a backend command

1. Add or extend the Go method in the backend file closest to the feature
2. Register/bind the service in `main.go`/Wails setup if it is a new service
3. Regenerate or verify Wails bindings in `frontend/wailsjs/go/main/*` when needed
4. Add a frontend wrapper in `frontend/src/lib/<feature>-api.ts` when one does not exist

### Add a frontend component

1. Create `frontend/src/components/<area>/<Component>.tsx`
2. Export and import in `App.tsx`
3. Add to routing/rail/modal system
4. Persist state using the existing store, settings binding, bbolt-backed API, or workspace file for that module

### Add a developer utility

1. Add tab to `frontend/src/components/utils/UtilsPanel.tsx` or the more coherent dedicated panel
2. Keep logic local unless reusable elsewhere
3. Follow existing switch/state patterns

### Add a protocol (SOAP, gRPC, etc.)

1. Add backend Go support in the closest protocol file or create `<protocol>.go`
2. Add panel in `frontend/src/components/<protocol>/<Protocol>Panel.tsx`
3. Add rail icon and routing in `App.tsx`
4. Update import/export to include protocol-specific data

---

## Testing Strategy

**Product-first testing: verify the user experience, not code coverage.**

For changes:

- Run `npm run build` to catch TypeScript errors
- Run `go test ./...` for Go backend checks
- Test integration in dev mode with `wails dev`
- **Manually test the full user experience** — open the panel, use it as a real user would
- Verify that the workflow is fluid from start to finish
- Verify visual cohesion with adjacent panels

High-value test targets (what users actually do):
- Variable substitution (`{{var}}`) across all fields
- Auth flows end-to-end (OAuth2, AWS4)
- Mock path matching (`:param`, `*`, `**`) with real requests
- Proxy breakpoints and map local/remote with real traffic
- Workspace import/export with real data
- Postman v2.1 parser with real files

What we DON'T chase:
- 100% code coverage
- Unit tests for every function
- Tests that don't simulate real usage

---

## Security and Privacy Constraints

- **Local-first by design** — no telemetry, no external calls
- **Plaintext storage** — localStorage is not encrypted, document this
- **Script execution** — user scripts run in renderer, warn about risks
- **Certificate handling** — validate cert paths, never auto-trust
- **Proxy CA export** — in progress, document trust implications

---

## Known Pain Points

- localStorage size limits (≈5-10MB) — large workspaces may hit this
- Wails build requires Go, Node.js, and platform-native dependencies
- HTTPS interception CA export incomplete (TODO)
- Flow Builder definitions persist in bbolt; keep runtime results separate from saved definitions
- Plugin system architecture in progress
- Browser debugging integration early stage

---

## Documentation Expectations

Update docs when behavior changes:

- `README.md` for user-visible features
- `docs/BUILD.md` for build/distribution changes
- `docs/RELEASE.md` for release-worthy changes
- `.github/SECURITY.md` for security posture changes
- `docs/ISSUES.md` and `docs/ROADMAP.md` when feature status changes
- `docs/SOUL.md` when product vision or UX philosophy evolves
- `AGENTS.md` for detailed architecture/pattern guidance

---

## Agent Operating Style

When working in this repo, think like a **product engineer**, not a code monkey:

1. **Product-first, always** — every decision starts from "how does the user see this?"
2. **Respect the four pillars** — every change should reinforce local-first, extensibility, browser integration, or enterprise/legacy support
3. **The frontend is NOT almost done** — it's the least mature part. Treat it as such. Don't assume "it already works."
4. **Connect backend and frontend** — if a Go method/binding exists without UI, that's the priority
5. **Every panel must feel like part of the same product** — visual cohesion, same UX patterns, same design language
6. **Prefer small, surgical edits** — don't refactor unrelated code
7. **Reuse existing patterns** — follow component structure, storage keys, auth flows
8. **Keep it local-first** — no external network calls without explicit user action
9. **Document breaking changes** — especially in workspace format or storage keys
10. Before finalizing, summarize changed files and verification commands

---

## Four Pillar Decision Framework

When proposing a feature, ask:

1. **Local-First:** Does this keep data local? Can it work offline? Is it shareable as a file?
2. **Extensible:** Can users customize it? Is it pluggable? Template-able?
3. **Browser Integration:** Does this tie API testing to web debugging? Does it reduce tool switching?
4. **Enterprise/Legacy:** Does this support protocols/standards that Postman ignores? Banking, gov, legacy systems?

If a feature scores 0/4, reconsider. If it scores 2+, it's likely a good fit.

---

## Related Files

Four files live at the root — everything else is under `docs/`:

- `README.md` — User-facing overview, quick start, feature list
- `AGENTS.md` — Detailed architecture, conventions, file-by-file breakdown
- `LICENSE.md` — MIT license
- `CLAUDE.md` — This file

### docs/ index

| File | Purpose |
|------|---------|
| `docs/SOUL.md` | Product philosophy, UX principles, long-term vision |
| `docs/funzionalita.md` | Fast complete catalog of product features and modules |
| `docs/ROADMAP.md` | Roadmap/checklist of completion by product area |
| `docs/ISSUES.md` | Open bugs and missing features — the active work queue |
| `docs/BUILD.md` | Build instructions for all platforms |
| `docs/INSTALL.md` | End-user installation guide |
| `docs/RELEASE.md` | Release notes and history |
| `docs/FAQ.md` | Frequently asked questions |
| `docs/TROUBLESHOOTING.md` | Common problems and fixes |
| `docs/ARCHITECTURE.md` | High-level architecture overview |
| `.github/SECURITY.md` | Security policy (picked up by GitHub's Security tab) |
