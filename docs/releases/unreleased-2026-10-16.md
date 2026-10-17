# Unreleased — 2026-10-16 (develop)

Go Studio toolbar and Run window, faster IDE startup, TODO export, and a Windows fix for Claude Code in milk.

## Fixes

- **milk · Claude Code on Windows.** `cannot open Claude Code session … milk error -32603` was caused by Node refusing to spawn npm's `claude.cmd` shim (`spawn EINVAL`). milk now points the agent at the first real `claude.exe` on `PATH` through `CLAUDE_CODE_EXECUTABLE`. An explicit `CLAUDE_CODE_EXECUTABLE` still wins. (`internal/milk/nativeclaude.go`)

## Go Studio

- **gopls warm-up.** The last trusted project's gopls now starts while adOmnia boots (after the first stable frame, when the UI is idle), so "Setting up workspace" is done by the time Go Studio opens. Only runs for people who have used Go Studio before; an idle gopls still suspends itself after 5 minutes.
- **TODO export.** The TODO window has a new **Export .md** button. The report has a summary table, one section per module/service, then per file with `- [ ]` checklists. Folders without a manifest are grouped by service folder (`services/users`, `apps/web`…); only root files land in "(outside any module)".
- **New toolbar look.** Project, branch, search, run and workspace are bordered pills; the branch has a purple icon and change counter, search shows its shortcut as key caps, Run/Debug/Stop are one grouped control, and the workspace shows its project count. The "Restore adOmnia header" button is gone (Ctrl+Shift+F11 still toggles maximize from the menu).
- **Service logs live inside Run.** The separate "Service logs" tool window and its stripe button are removed. Run shows a tab bar with one tab per service/execution (when there is more than one) and a **Logs only** toggle that hides adOmnia's system lines.

## Also in this batch

Work in progress from the IDE settings and Git areas that was already in the tree: project settings JSON with completion, `when` contexts for keybindings, legacy keymap import, and Git log/graph updates (`goStudioGitLog.css`, `GitCommitGraph`).

## Verification

`tsc --noEmit` clean; 1796 frontend tests pass; `go vet ./internal/milk` clean. Not exercised in the running desktop app yet: gopls warm-up, TODO export save dialog, the new toolbar and the Run service tabs.
