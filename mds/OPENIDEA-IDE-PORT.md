# OpenIDEA IDE port: first block

Scope: shared live templates and Surround With; session-local workspace Undo/Redo
for text-only refactoring of existing documents. Research and next stages:
`docs/OPENIDEA-IDE-GAP-ANALYSIS.md`.

## Implemented

- [x] Twenty built-ins contributed by Go, Java, Python, Rust and web adapters.
- [x] Linked fields, literal escaping and selected-code indentation.
- [x] Existing palette, Code/context-menu commands and standard snippet completion.
- [x] Validated local JSON import/export; atomic custom-set update and merge by id.
- [x] Bounded per-session workspace history; whole-operation refusal on changed,
  closed or read-only documents; cleanup on session close.
- [x] Refactoring revalidation after asynchronous loading and active-session checks.
- [x] Browser fixture with actual Monaco: Python surround, field editing/Tab,
  repeated Java fields, empty search, Escape, both themes, Undo/Redo and conflicts.

## Native desktop acceptance — not yet performed

Automatic verification: 97 focused tests across 13 files, TypeScript, production
frontend build, focused Oxlint and startup gate passed. The startup report has
654,772 initial JavaScript bytes, no eager optional styles and no deferred IDE
modules on the entry graph. Build retains the existing large-chunk warnings.
No backend code was changed by this block; the concurrently modified Database
files belong to separate work and were not edited here.

- [ ] OI-M1: Code menu and context menu, Ctrl/Cmd+J and Ctrl/Cmd+Alt+T; focus returns
  to the first snippet field after Enter, and to the editor after Escape.
- [ ] OI-M2: Go, Java, Python, Rust and JS/TS real projects; nested/multiline
  selections, tabs/spaces, CRLF/Unicode and ordinary Ctrl+Z.
- [ ] OI-M3: Completion with Emmet/LSP/Copilot and Vim/Emacs; custom keymap bindings.
- [ ] OI-M4: Export/import native file dialogs, invalid JSON, repeated ids, full
  storage, Unicode paths; old templates survive rejected imports.
- [ ] OI-M5: Preview/apply/Undo/Redo a real multi-file rename; then edit/close one
  target and verify that Undo refuses without touching the other files.
- [ ] OI-M6: Save/autosave after Undo; external disk-change prompt remains intact.
- [ ] OI-M7: Independent histories in two projects and detached windows; switching
  project while a template picker/refactoring is pending; close/reopen cleanup.

## Intentionally unfinished stages

- [ ] Filesystem transactions and global Undo for create/delete/move.
- [ ] Postfix and graphical template management.
- [ ] Shared scopes, inspection profiles, Safe Delete and changelists.
- [ ] Structural search/replace and duplicates.
