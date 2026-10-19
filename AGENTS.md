# AGENTS.md

Entry point for AI agents working in this repository.

**All architecture, conventions, patterns, and change recipes live in [`CLAUDE.md`](CLAUDE.md).**
This file used to duplicate that content and drifted out of sync. It is now a pointer only — do not re-add duplicated sections here. If something is wrong or missing, fix it in `CLAUDE.md`.

---

## Read this first

| Read | When |
|------|------|
| [`CLAUDE.md`](CLAUDE.md) | Always. Product philosophy, architecture, directory structure, coding conventions, change recipes, four-pillar framework. |
| [`docs/SOUL.md`](docs/SOUL.md) | The change touches UX, product positioning, visual design, or perceived behavior. |
| [`docs/adomnia-feature-catalog.en.md`](docs/adomnia-feature-catalog.en.md) | You need to know what already exists, so you don't rebuild an existing module. |
| [`docs/ISSUES.md`](docs/ISSUES.md) | You want the active work queue and current completion status. |
| [`README.md`](README.md) | You need the user-facing product framing. |

---

## Before touching code

1. **Read `CLAUDE.md`** — architecture, patterns, Wails/Go bindings.
2. **Read `docs/SOUL.md`** if the change affects UX, product positioning, visual design, or perceived behavior.
3. **Check `docs/adomnia-feature-catalog.en.md`** to avoid duplicating an existing module.
4. **Find the file closest to the feature** — this project prefers small, localized changes over refactors.
5. **Stay local-first** — data belongs in local storage, bbolt, localStorage, or an exportable file. No telemetry, no cloud calls.
6. **If you touch storage, settings, or the `.adomnia` workspace format**, preserve backward compatibility and document the migration.
7. **Every feature should hit at least 2 of the 4 pillars** — see "Four Pillar Decision Framework" in `CLAUDE.md`.
8. **Backend logic goes in `internal/<domain>/`** — the Go root is a Wails binding layer only.

### Entity router (cross-panel navigation)

New cross-panel actions go through `frontend/src/lib/entities/`, not new `CustomEvent`s:
- register what your panel opens with `registerOpener(kind, { intent, title, run })` in `lib/entities/openers.ts`;
- if the panel must be mounted to act, call `handoffToPanel(rail, ref, intent, payload)` from the opener and receive it in the panel with `useEntityHandoff(rail, handler)` — return `false` while the panel is not ready (e.g. still hydrating) and it is retried.
Project entities come from `internal/devcontext` (Go) via `stores/devcontext.ts`.

### IDE languages (Code Studio platform)

Code Studio is the IDE Platform with Go as its first language adapter; read `docs/architecture/ide-multilanguage-refactor.md` before touching `internal/codestudio`, `internal/ide` or `internal/languages`.
- The core (`internal/ide/*`) never imports an adapter or Go tooling; `internal/ide/architecture_test.go` enforces it. Languages are registered in `internal/codestudio/languages.go`.
- The frontend learns registered languages from `GetCapabilities().languages` and describes each one in `frontend/src/components/ide/languages/<id>/` (icon, menu, commands with `requires`, Monaco editor languages). Never hard-code `'go'` in shared editor code: use `languageServerEditorLanguages()` / `ideLanguageForEditor()`.
- `Project` has only language units: derive Go modules with `goLayoutOf` (Go) or `goProjectLayout` / `goModules` (`lib/code-studio/goProject.ts`).

### Code Studio dialogs

Every Code Studio modal uses `CodeStudioModal`, every search palette `CodeStudioPalette`, both in `frontend/src/components/code-studio/CodeStudioModal.tsx`. Never hand-build a backdrop, shell, header or footer.
- Controls come from the same file (`CodeStudioButton`, `CodeStudioField`, `CodeStudioAlert`, `CodeStudioCommandPreview`) or from the `gs-*` classes in `codeStudioModal.css` (`gs-input`, `gs-mono`, `gs-list`, `gs-list-row`, `gs-badge`, `gs-kbd`, `gs-segmented`, `gs-switch`, `gs-popover`).
- The classes live in `@layer components`, so Tailwind utilities still override them; the modal sets its own sans font, so it looks the same when mounted outside `.code-studio-root`.
- `data-autofocus` picks the initial focus (the primary action of a confirmation); `persistent` keeps a backdrop click from closing decisions that must not be lost.

---

## Verification

Use proportionate verification while implementing individual features. Run the
smallest focused tests that cover the changed behavior, plus the relevant type
or build check. Do not run the complete frontend Vitest suite after every
feature: it currently contains more than 1,300 tests and wastes time and token
budget when repeated without a specific reason.

Run the complete frontend and Go suites at release/final integration
checkpoints, after broad cross-cutting changes, or when focused results expose a
regression outside the edited module. Record manual desktop checks separately;
an automated build does not prove native Wails behavior.

```bash
cd frontend && npx vitest run <focused-test-files>  # Per feature
npx tsc --noEmit                                # TypeScript changes
npm run build                                   # UI integration checkpoint
go test ./internal/<changed-domain>/...          # Per backend feature
go build ./...                                   # Backend integration checkpoint
wails3 task dev                                  # Manual UI/product check
```

The last one matters most. This is a product, not a library: open the panel and use it as a real user would before calling a change done.

## Website sync on every release tag

Bumping the release tag on `main` also requires updating the website repo (`Andrea-Cavallo/adOmniaWeb`, local `C:\Users\Andrea\Desktop\adomniaWeb\adOmniaWeb`, Vercel deploys from `master`). Download links and version badge follow the latest GitHub release automatically; still verify them, and update `index.html` copy, `assets/shots/` screenshots, platform requirements and asset-name patterns when the release changes them. Push to `master`.
