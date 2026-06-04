# TODO.md

## Markdown Workspace / Notes Graph

- [x] Status: Phase 0-5 complete; implementation cleanup and deep verification remain in Phase 6-7.
- [x] Goal: turn the current Markdown panel from a simple single-note editor into a local-first Markdown workspace that can create notes, open/import folders of `.md` files, and show relationships between notes with an Obsidian-style graph.

### Product Principles

- [x] Keep Markdown files local and readable as normal `.md` files.
- [x] Do not lock users into a proprietary note format.
- [x] Support opening an existing folder in place by default.
- [x] Add an explicit copy/import-into-workspace action later.
- [x] Make the workflow feel like a real desktop tool: create, open, save, search, navigate links, inspect graph.
- [x] Reuse adOmnia's compact developer-tool visual language instead of making the Markdown area feel like a separate app.

### Current Problems

- [x] The Markdown panel does not provide a simple "New `.md` file" flow.
- [x] The user cannot open or import a folder containing multiple Markdown files.
- [x] There is no file tree for navigating notes.
- [x] There is no persistent filesystem-backed save workflow.
- [x] The current editor is mostly an isolated note surface, so it does not behave like a real notes workspace.
- [x] Internal links between notes are not indexed.
- [x] There is no backlinks panel.
- [x] There is no graph view showing relationships between notes.

### Phase 0: Design The Model

- [x] Define the core domain type `MarkdownFileEntry`.
- [x] Define `MarkdownWorkspace`.
- [x] Define `MarkdownLink`.
- [x] Define `MarkdownGraphNode`.
- [x] Define `MarkdownGraphEdge`.
- [x] Decide storage ownership: opened folder path stays local on disk.
- [x] Persist recent folder locally.
- [x] Persist complete Markdown UI state locally.
- [x] Avoid copying file contents to localStorage.
- [x] Support `.md`.
- [x] Support `.markdown`.
- [x] Ignore `.git`.
- [x] Ignore `node_modules`.
- [x] Ignore build/output folders.
- [x] Ignore hidden folders by default.
- [x] Use "open folder in place" as the default behavior.
- [x] Add optional "copy folder into adOmnia workspace" behavior later.

### Phase 1: Core File Operations

- [x] Add a clear "New note" action in the Markdown panel.
- [x] Show a filename input for creating a new `.md` file.
- [x] Validate filenames and prevent path traversal in the backend.
- [x] Create the file on disk through Wails/Go bindings.
- [x] Open existing `.md` files from disk.
- [x] Save the active note.
- [x] Support `Ctrl+S` and `Cmd+S` for save.
- [x] Add "Save as" for standalone notes.
- [x] Track dirty state for unsaved edits.
- [x] Warn before switching notes with unsaved edits.
- [x] Add an empty state for opening a folder or creating a note.
- [x] Show human-readable filesystem errors in the UI.

### Phase 2: Folder Open / Import

- [x] Add "Open folder" for Markdown workspaces.
- [x] Recursively scan supported Markdown files.
- [x] Build a compact note list for navigation.
- [x] Build a real collapsible folder tree.
- [x] Sort files alphabetically.
- [x] Add search/filter across filenames.
- [x] Add quick open/search for notes.
- [x] Allow creating a note inside the selected folder.
- [x] Allow rename with validation.
- [x] Allow delete with confirmation.
- [x] Preserve the real folder structure on disk.
- [x] Store recent Markdown folders locally.

### Phase 3: Markdown Parsing And Navigation

- [x] Parse standard links like `[label](note.md)`.
- [x] Parse relative standard links like `[label](folder/note.md)`.
- [x] Parse heading anchors enough to ignore the anchor for file resolution.
- [x] Parse wiki links like `[[Note]]`.
- [x] Parse nested wiki links like `[[folder/Note]]`.
- [x] Parse wiki heading links enough to ignore the heading for file resolution.
- [x] Parse wiki aliases like `[[Note|Alias]]`.
- [x] Detect unresolved links.
- [x] Make internal links clickable in preview.
- [x] Support task lists in preview.
- [x] Support tables.
- [x] Support frontmatter detection.
- [x] Support tags from frontmatter.
- [x] Support inline `#tags`.
- [x] Keep rendering safe by blocking dangerous script URLs.

### Phase 4: Backlinks And Graph View

- [x] Build an index of all notes in the open folder.
- [x] Create graph data from parsed note links.
- [x] Create graph edges from parsed links.
- [x] Persist an agent-readable graph JSON file at `.adomnia/markdown-graph.json`.
- [x] Include nodes, edges, headings, tags, outgoing links, unresolved links, and backlinks in the agent graph JSON.
- [x] Show unresolved links as distinct unresolved rows.
- [x] Add a backlinks panel for the active note.
- [x] Add an initial graph inspector view.
- [x] Replace the graph inspector with a first SVG graph view.
- [x] Add pan/zoom to graph view.
- [x] Add fit to view.
- [x] Add draggable graph nodes.
- [x] Add a deterministic force-style layout pass.
- [x] Add basic search node through quick open/filter.
- [x] Add focus current note.
- [x] Add filter by folder.
- [x] Add basic filter by tag through tag chips.
- [x] Add show/hide unresolved links.
- [x] Add show/hide orphan notes.
- [x] Use a proven graph/force-layout library or canvas approach for the final graph.
- [x] Re-index after save, create, and folder open.
- [x] Re-index after rename.
- [x] Re-index after delete.

### Phase 5: Product Polish

- [x] Use a three-area layout: file list, editor/preview, graph/backlinks.
- [x] Replace the file list with a polished collapsible file tree.
- [x] Add an outline panel based on headings in the active note.
- [x] Add `Ctrl+N` / `Cmd+N`: new note.
- [x] Add `Ctrl+O` / `Cmd+O`: open Markdown folder.
- [x] Add `Ctrl+S` / `Cmd+S`: save.
- [x] Add `Ctrl+P` / `Cmd+P`: quick open note.
- [x] Add `Ctrl+Shift+F` / `Cmd+Shift+F`: search notes.
- [x] Add drag-and-drop for `.md` files and folders.
- [x] Add compact status for active folder.
- [x] Add compact status for note count.
- [x] Add compact status for link count.
- [x] Add compact status for unresolved link count through unresolved rows.
- [x] Verify the UI stays dense and calm on smaller screens.

### Phase 6: Implementation Notes

- [x] Add backend bindings in `markdown.go`.
- [x] Add `ListMarkdownFiles`.
- [x] Add `ReadMarkdownFile`.
- [x] Add `WriteMarkdownFile`.
- [x] Add `CreateMarkdownFile`.
- [x] Add `RenameMarkdownFile`.
- [x] Add `DeleteMarkdownFile`.
- [x] Add frontend API wrapper `frontend/src/lib/markdown-api.ts`.
- [x] State management for the Markdown workspace. _(Implemented with
  component-local state in `MarkdownPanel` plus a presentational 7-component
  split and shared pure helpers in `frontend/src/lib/markdownDoc.ts`. A separate
  `stores/markdown.ts` was prototyped then removed as redundant for a single
  self-contained panel — no dedicated Zustand store is needed.)_
- [x] Keep the current Markdown panel route/component.
- [x] Split UI into `MarkdownToolbar`.
- [x] Split UI into `MarkdownFileTree`.
- [x] Split UI into `MarkdownEditor`.
- [x] Split UI into `MarkdownPreview`.
- [x] Split UI into `MarkdownGraphView`.
- [x] Split UI into `BacklinksPanel`.
- [x] Split UI into `MarkdownOutline`.
- [x] Keep current Markdown content compatible during migration.

### Phase 7: Verification

- [x] Verify with a real folder containing at least 20 Markdown files.
- [x] Verify standard links and wiki links.
- [x] Verify create, edit, save, close, reopen.
- [x] Verify folder open does not mutate files unless the user saves changes.
- [x] Verify graph updates after editing links.
- [x] Verify rename updates graph state.
- [x] Verify unresolved links remain visible.
- [x] Verify keyboard shortcuts on Windows, macOS, and Linux where possible.
- [x] Run `npm run build`.
- [x] Run `go test ./...` if Go bindings are added.

### Acceptance Criteria

- [x] A user can open the Markdown panel and create a new `.md` file without friction.
- [x] A user can open/import a folder with multiple `.md` files and browse them in a list.
- [x] A user can browse notes in a real folder tree.
- [x] A user can edit and save Markdown files locally.
- [x] A user can click internal Markdown links to navigate between notes.
- [x] A user can see backlinks for the active note.
- [x] A user can see an initial graph/link inspector.
- [x] A user can open a first graph view that shows notes and links between them.
- [x] A user can pan/zoom the current graph view.
- [x] A user can pan/zoom a production graph view backed by a dedicated force-layout library.
- [x] Agents can read `.adomnia/markdown-graph.json` to understand the note graph.
- [x] Unresolved links are visible and understandable.
- [x] The workflow remains local-first and offline.
