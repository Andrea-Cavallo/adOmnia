# Unreleased — 2026-10-21 (develop)

Code Studio grows beyond Go: Python (run, pytest, debugpy, basedpyright), Java and web share one Run UI, and the multi-language plan in `mds/MULTILANGUAGE-IDE.md` is mostly closed in code. Native desktop acceptance for the new UI is still listed in `mds/MANUAL-CHECK.md`.

## Breaking changes and migrations

- **Product name.** "Go Studio" is now **Code Studio** in the Hub, rail, window titles, menus and messages. Internal names moved with backward compatibility: rail id `goide` → `codestudio` (read-time alias), localStorage `adomnia.goide.*` → `adomnia.codestudio.*` (one-shot copy, old keys kept for rollback), packages `internal/goide` → `internal/codestudio`, `goidewindow` → `codestudiowindow`, events `goide:*` → `code-studio:*`. The Wails service is still `GoIDE` and Docker labels/buckets keep their historical names; `.adomnia/run-configurations.json` keeps its format.
- **Run configurations.** The persisted file is unchanged for existing projects. Go-specific fields remain readable and are mirrored in `languageOptions` for one release; new fields live in the language adapter.
- **Python settings.** The interpreter is stored in `.adomnia/python.local.json` (machine-local, never shared). Shared run configurations keep `interpreter` optional and never contain secrets or resolved environment values.

## Code Studio

- **One Run UI.** Run/Debug/Test/Edit toolbar, provider-driven form (`GetRunSchema`), detection cards, unit grouping with language icons, environment profiles, before-launch tasks, compound readiness and restart rules; the same component serves Go, web, Java and Python.
- **Python.** Script/module runs, pytest test tree with real node IDs and captured stdout/stderr, optional **pytest-cov coverage** (files and per-line overlay in the existing Coverage view; no pytest-cov, no hidden install), debugpy debugging (breakpoints, step, evaluate, exception breakpoints) with an explicit attach to a running `debugpy --listen` listener, basedpyright editing with explicit installation, per-unit interpreters, and explicit environment actions (`Create environment…`, `Install dependencies…`) that never run `uv`/`poetry` sync implicitly. Framework suggestions (Django, FastAPI, Flask) use guided host/port/reload fields and a missing dependency is visible in the interpreter dialog. Formatting is optional **Ruff** (pinned 0.13.2, installed explicitly from the interpreter dialog; basedpyright does not format). New Project offers **Python script** and **Python project (pytest)** templates (files only — nothing is installed or executed); the gutter ▶ runs or debugs a script at its `__main__` guard; the Run panel offers **Open in browser** when the server prints a local URL; the interpreter dialog shows each interpreter's architecture and flags versions that do not satisfy the project's `requires-python`.
- **Unit icons and multi-row tabs.** The Run bar and configuration list show each unit's language icon; View → **Multi-Row Editor Tabs** wraps the tab row to at most two lines, keeping pin, preview, close and keyboard behaviour.
- **AI commit messages.** A local preference chooses Conventional Commits (default), free-form prose or a template with `{{summary}}`/`{{body}}`; the prompt is language-neutral and the draft stays editable. Redaction and the project AI policy are unchanged.
- **Markdown.** Yuque callouts (`:::info`, `:::warning`, …), `==highlight==` and stable heading ids were added with an acceptance corpus; maths, footnotes, generated `[TOC]` and PlantUML remain text, as documented in `docs/CODE-STUDIO.md`.

## Agents and MCP (Claude Code / milk)

- **Claude/milk parity and milk 0.7.** Both chat panels share a live project context (unsaved source, optional selection, project rules, filtered paths, language units) with independent selection, and advertise model selectors from the agent's own capabilities (modern and legacy ACP). External UTF-8 text files and capability-gated images can be attached — backend MIME/size validation, attachment bytes never stored in transcripts — and a failed send keeps the draft and the attachments. Milk 0.7 shapes are supported where they exist: configured-primary agent selection (with a config backup and a fresh project chat), native routing/reasoning controls and task-plan display; fresh-session metadata prevents invisible adoption of an old conversation. The installed milk stays 0.5.4 (0.7.0 was inspected, never auto-installed), and because milk 0.7's ACP prompt handler reads text blocks only, images over that transport are rejected explicitly instead of silently dropped.
- **MCP context servers gated by the AI policy.** One list of MCP servers (stdio or HTTP) in the milk settings is passed to Claude Code and milk at every new chat session; the project AI policy now gates it — `off` sends none, `local-only` keeps stdio and drops HTTP. The policy itself moved into a dependency-free `internal/aipolicy` package used by every agent launcher (Copilot, milk, Claude Code), fail-closed on unknown values. Verified in the field that milk accepts `mcpServers` in `session/new`.

## Performance and memory

- **Response rendering.** One memoized parse per response (validity badge + graph payload) and a memoized pretty body (`prettyJson` gained a `validate` flag): the second `JSON.parse` per render is gone.
- **Large bodies spill to disk.** Response bodies over 1 MiB are persisted outside the session JSON (`response-body:<id>` in local storage); the session keeps a 32 KB preview and the weight, and opening the entry reloads the full body. A build that predates this change reads the preview, not the body.
- **Byte budgets, not just counts.** Log Inspector events are capped by bytes (64 MiB, 8 MiB for live sources, the newest entry is always kept) and the Go log ring adds a 32 MiB byte budget; the GraphQL schema cache prunes by weight (8 MiB) as well as by count; the HAR viewer strips bodies over 512 KB out of memory and reloads them on demand ("Load body", exports rewrite the original file so nothing is lost); the flow recorder drops bodies over 2 MiB while recording.

## Debugging and insights

- **Static launch linking.** Delve's goroutine list and pprof profiles now link back to the static launch site ("Static launch" chip in the goroutine tree and in the profile panel), joining the race detector's "created at" frames. The match is by function-name segment, so homonyms can confuse it.

## Verification

`go build ./...` and `go vet ./...` are clean, and the complete `go test ./...` passes for every package in this batch (targeted suites during development: `internal/languages/python` with real pytest 9.1.1, debugpy 1.8.22 and basedpyright 1.40.2 checks — including an unresolved-import reproduction against a real project — plus `internal/ide/dap`, `internal/codestudio`, `internal/logstream`, `internal/milk`, `internal/aipolicy` and `internal/copilot`). The frontend suite is fully green (444 files / 2203 tests); `npx tsc --noEmit`, `npm run build` and `npm run check:startup` pass. Not verified in the running desktop app: the new Run UI in both themes, multi-row tabs, Yuque callouts, and every `ML-*`/`PY-M*` item in `mds/MANUAL-CHECK.md`.

**Not included in this batch:** the collaborative recovery-snapshot work (persisted snapshots, guest baselines, `snapshot.missed`) is still in progress — its own tests do not pass yet (three failures and one hang in `internal/collab`). It is parked on the `wip/collab-recovery` branch and deliberately kept off `develop`.
