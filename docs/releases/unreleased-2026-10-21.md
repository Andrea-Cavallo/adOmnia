# Unreleased — 2026-10-21 (develop)

Code Studio grows beyond Go: Python (run, pytest, debugpy, basedpyright), Java and web share one Run UI, and the multi-language plan in `mds/MULTILANGUAGE-IDE.md` is mostly closed in code. Native desktop acceptance for the new UI is still listed in `mds/MANUAL-CHECK.md`.

## Breaking changes and migrations

- **Product name.** "Go Studio" is now **Code Studio** in the Hub, rail, window titles, menus and messages. Internal names moved with backward compatibility: rail id `goide` → `codestudio` (read-time alias), localStorage `adomnia.goide.*` → `adomnia.codestudio.*` (one-shot copy, old keys kept for rollback), packages `internal/goide` → `internal/codestudio`, `goidewindow` → `codestudiowindow`, events `goide:*` → `code-studio:*`. The Wails service is still `GoIDE` and Docker labels/buckets keep their historical names; `.adomnia/run-configurations.json` keeps its format.
- **Run configurations.** The persisted file is unchanged for existing projects. Go-specific fields remain readable and are mirrored in `languageOptions` for one release; new fields live in the language adapter.
- **Python settings.** The interpreter is stored in `.adomnia/python.local.json` (machine-local, never shared). Shared run configurations keep `interpreter` optional and never contain secrets or resolved environment values.

## Code Studio

- **One Run UI.** Run/Debug/Test/Edit toolbar, provider-driven form (`GetRunSchema`), detection cards, unit grouping with language icons, environment profiles, before-launch tasks, compound readiness and restart rules; the same component serves Go, web, Java and Python.
- **Python.** Script/module runs, pytest test tree with real node IDs and captured stdout/stderr, debugpy debugging (breakpoints, step, evaluate, exception breakpoints), basedpyright editing with explicit installation, per-unit interpreters, and explicit environment actions (`Create environment…`, `Install dependencies…`) that never run `uv`/`poetry` sync implicitly. Framework suggestions (Django, FastAPI, Flask) use guided host/port/reload fields and a missing dependency is visible in the interpreter dialog. Formatting is optional **Ruff** (pinned 0.13.2, installed explicitly from the interpreter dialog; basedpyright does not format).
- **Unit icons and multi-row tabs.** The Run bar and configuration list show each unit's language icon; View → **Multi-Row Editor Tabs** wraps the tab row to at most two lines, keeping pin, preview, close and keyboard behaviour.
- **AI commit messages.** A local preference chooses Conventional Commits (default), free-form prose or a template with `{{summary}}`/`{{body}}`; the prompt is language-neutral and the draft stays editable. Redaction and the project AI policy are unchanged.
- **Markdown.** Yuque callouts (`:::info`, `:::warning`, …), `==highlight==` and stable heading ids were added with an acceptance corpus; maths, footnotes, generated `[TOC]` and PlantUML remain text, as documented in `docs/CODE-STUDIO.md`.

## Verification

`go build ./...`, `go vet` and the targeted Go suites (`internal/ide/...`, `internal/languages/...`, `internal/codestudio` subsets) pass; the complete `internal/codestudio` suite still times out on the watcher (known, unrelated to this batch). `npx tsc --noEmit` is clean for the touched files; focused Vitest suites pass; `npm run build` and `npm run check:startup` are green. Real-tool checks: pytest 9.1.1 test tree and captured output, debugpy 1.8.22 breakpoint/step/relaunch, Python 3.11 run and stop. Not verified in the running desktop app: the new Run UI in both themes, multi-row tabs, Yuque callouts, and every `ML-*`/`PY-M*` item in `mds/MANUAL-CHECK.md`.
