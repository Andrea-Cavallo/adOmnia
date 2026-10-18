# CLAUDE.md — adOmnia IDE (Code Studio / IDE Platform)

Guidance for Claude Code when touching **any part of the IDE**. It adds to the root `CLAUDE.md` (product-first, local-first, reuse, small surgical edits) and does not replace it. This file is loaded when you work under `internal/ide`, `internal/codestudio`, `internal/languages`, `frontend/src/components/code-studio` and `frontend/src/components/ide` (the last four hold a one-line pointer to it).

The IDE is a flagship area: it must feel like a real IDE (fast, stable, never losing user work), not a demo.

---

## What it is

**adOmnia IDE Platform + language adapters.** Code Studio is the Go adapter on top of a language-agnostic core. Go is the primary language; the web frontend languages (TypeScript/JavaScript, HTML, CSS, JSON in `internal/languages/web`) are the second adapter, with the Live Server in `internal/ide/preview` (see `docs/LIVE-PREVIEW.md`); Java/Rust/Python are validation scenarios, not features.

Read before non-trivial work:

| File | Use |
|------|-----|
| `docs/architecture/ide-multilanguage-refactor.md` | GENERIC/MIXED/GO_SPECIFIC map, interfaces, migration (12 phases, complete), non-goals, manual smoke checklist |
| `docs/CODE-STUDIO.md` | Usage, trust model, optional tools, persistence schema, shortcuts, limits |
| `mds/03-GO-STUDIO-PIANO-UNIFICATO.md` | Active work queue (manual checks, gaps) |
| `mds/FIX.md` | Open fixes |
| `docs/SOUL.md` | Any UX / visual decision |

---

## Where code lives

```
internal/ide/*              CORE, language-agnostic: language (Language + capabilities, registry), project (Unit),
                            lsp, dap, run, testing, sdk, process, security, graph, apicontract, remote, startup
internal/ide/preview/       Live Server (static server, dev-server proxy, preview Manager), language-agnostic
internal/languages/web/     Web ADAPTER: typescript/html/css/json, project + package-manager detection, LSP specs
internal/languages/golang/  Go ADAPTER: detection, SDK, gopls ServerSpec, run options, test2json, race reports,
                            Delve/runtime extensions, architecture/error/context analyses…
internal/codestudio/             HOST: composition root + `Service` facade for Wails; languages registered in languages.go;
                            code not yet migrated still lives here
internal/codestudiowindow/       native per-session windows
code_studio_bindings.go (root)    thin Wails service `GoIDE` — the STABLE facade
frontend/src/components/ide/languages/<id>/   language contributions (IdeLanguageContribution)
frontend/src/components/code-studio/                Code Studio UI (CodeStudioPanel.tsx etc.)
frontend/src/lib/code-studio/                       pure helpers used by stores
frontend/src/stores/codeStudio*.ts                 stores (one per concern)
```

### Hard rules (enforced by tests — they fail the build)

- Dependency direction: `internal/codestudio` (host) → `internal/ide/*` (core) ← `internal/languages/<lang>` (adapter).
- The core **never** imports an adapter or Go tooling libs (`golang.org/x/mod`, `x/tools`, `x/exp/trace`, pprof…). Adapters **never** import `internal/codestudio`. See `internal/ide/architecture_test.go`.
- Any feature that starts a process must go through the process layer and check `session.Project.Authorization == AuthorizationPermitted` (`process_launch_guard_test.go` guards this).

### Placement decision

1. Language-agnostic (editor, terminal, processes, search, SDK plumbing, LSP/DAP lifecycle) → `internal/ide/*`.
2. Go-only (gopls, Delve, go.mod, pprof, race…) → `internal/languages/golang`.
3. The `internal/codestudio` `Service` method only wires; keep it thin. Unmigrated code: extend in place, move it when a second language needs it.
4. Search for an existing helper first (tool locator, process spec, event router…). No sixth copy of "find this tool on PATH".

---

## Platform conventions

- **Capabilities are small interfaces** in `internal/ide/language` (`Language`, `ProjectDetector`, `DocumentSelector`, `Runner`, `TestRunner`, `DebugAdapterProvider`…), found by type assertion. Add one only together with its first real consumer in the core. No `switch language` in the core.
- **Languages registered in one place:** `internal/codestudio/languages.go`.
- **Projects are `project.Unit`s** (`go.mod`, tomorrow `pom.xml`/`package.json`); a folder can mix languages. `Project` has no Go fields: use `goLayoutOf(project)` (backend) or `goProjectLayout`/`goModules` from `lib/code-studio/goProject.ts` (frontend).
- **The UI learns languages from the backend** (`GetCapabilities().languages`). Monaco providers register on `languageServerEditorLanguages()`, never on a literal `'go'`.
- A language server is an `lsp.ServerSpec` built by its adapter (no `LanguageServerProvider` interface).
- Run-configuration DTO keeps its flat Go fields **on purpose**: it is the `.adomnia/run-configurations.json` format shared via Git. Migrate in loaders; never break persisted JSON.
- `ide/sdk` tool-version cache stays process-wide.

### Deliberate non-goals — do NOT "finish" these without a real second consumer
- Mass move of `components/code-studio` into `components/ide` (move a file when a second language uses it).
- `LanguageServerProvider` interface or a tool-window registry.
- Removing flat Go fields from the run-config DTO.

---

## Adding things

**A language:** package `internal/languages/<lang>` implementing `language.Language` + the capabilities it really supports; one line in `internal/codestudio/languages.go`; `lsp.ServerSpec` builder if it has a server; frontend folder `components/ide/languages/<lang>/` with its contribution (icon: add the Simple Icons slug to `scripts/generate-brand-icons.mjs`, regenerate) and one line in `IDE_LANGUAGES`.

**A feature:**
1. Place it (see above), expose in `code_studio_bindings.go`, regenerate bindings with the `wails3` pinned in `go.mod` (`go run github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.28 generate bindings …` if the CLI is absent).
2. Add the command to `components/code-studio/codeStudioCommands.ts` (menu, label, binding, availability reason when disabled), or to the language's `commands.ts` with `requires: { language }`; handle it in `CodeStudioPanel.tsx`. Menus, shortcuts and help read that registry.
3. Route backend events by `sessionId`/`resourceId` (+ `language` for language servers) in the matching `stores/codeStudio*.ts`. **State never crosses sessions.**
4. Stores import pure helpers from `lib/code-studio/`, never from `components/`.
5. **Keep Code Studio lazy:** never import its modules from `App.tsx` or startup code (`npm run check:startup` enforces it).
6. Update `docs/CODE-STUDIO.md` (+ the active mds plan) when behaviour, storage or shortcuts change.

---

## Product quality bar (IDE-specific)

- **Never lose user work:** unsaved buffers, crash recovery, resilient saves, terminals/processes closed on trust revoke.
- **Responsiveness:** nothing blocks the UI thread; heavy analysis is async/cancellable; respect low-resource mode; gopls lifecycle and resource monitor exist — reuse them.
- **Trust model:** untrusted project = no process launches, no tool execution. Errors shown to the user are clean (no raw terminal dumps).
- **Windows first-class:** hide spawned CLI consoles (`hide_windows.go`), path/URI and UTF-16 offsets handled in the lsp layer.
- **Visual cohesion:** IDE panels use the shared tokens, `ResizeHandle`, `PanelHeader`; both themes; no hardcoded palette colors; consistent hover/active/loading/error feedback; keyboard-friendly (tabs, menus, dialogs).
- **AI features** (Copilot, Ask AI, fixes): minimal context, cache, stream, measure token/latency; credentials never reach the renderer.

---

## Verification

Per CLAUDE.md root: focused tests, not the whole suite after every change.

```bash
# backend
go vet ./internal/ide/... ./internal/languages/... ./internal/codestudio/...
go test ./internal/ide/... ./internal/languages/golang/... ./internal/codestudio/ -run <Focus>
go test ./internal/ide/ -run 'Architecture|CoreDoesNot|AdaptersDo'   # layering gate
# frontend (from frontend/)
npx tsc --noEmit
npx vitest run src/components/code-studio/<file> src/lib/code-studio src/stores/codeStudio
npm run check:startup     # whenever imports around the entrypoint change
```

- **Never `go build .` in the repo root** (overwrites `adomnia.exe` with a console exe without icon): use `go vet` or `go build -o NUL`.
- Final integration of a big change: `npm run build`, then try it for real (`wails3 task dev`) — open the IDE, open a Go project, edit, run, debug, test. Verify the actual user flow, not just green tests.
- Manual smoke checklist: section 23 of the refactor doc.

---

## Don'ts

- Don't add feature logic to the root binding files.
- Don't hardcode `'go'`, `.go` or `gopls` in generic code (core, generic stores, generic editor providers).
- Don't duplicate tool-locator / process-spec / event-routing logic.
- Don't store per-session state in module-level globals.
- Don't touch persisted formats (`.adomnia/run-configurations.json`, bbolt schema, localStorage keys) without a loader migration and a note in `docs/CODE-STUDIO.md`.
- Don't ship a language that works only inside the editor: its HTTP routes, datasources, topics must reach the shared Developer Context entities so API Workspace, Mock and Live Session work like for Go (see "Language parity" in the root `CLAUDE.md`).
