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

---

## Verification

```bash
cd frontend && npx tsc --noEmit    # TypeScript
npm run build                      # Frontend build
go build ./... && go test ./...    # Go backend
wails dev                          # Manual product check — do this for UI work
```

The last one matters most. This is a product, not a library: open the panel and use it as a real user would before calling a change done.
