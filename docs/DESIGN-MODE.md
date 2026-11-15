# Live Preview Design Mode

Design Mode adds visual editing to a React development server already running in Code Studio Live Preview. Start the bridged dev-server preview, then use **Design Mode** (the pencil/ruler button or its entry in the preview menu). It is unavailable for a stopped preview, an unbridged page or a static preview.

The editor loads its engine, JSX parser and side panel on demand. The page loads the DOM-editing bridge only when Design Mode is enabled. The iframe channel checks the page and IDE origins; the page does not receive Wails bindings. Project files are read and edited through the existing Code Studio session APIs.

## Workflow

1. Open the React project in Code Studio and start its development server in Live Preview.
2. Enable **Design Mode** and review the source scan. The setup can add `data-oid` identifiers to JSX elements so the preview can map them back to source files.
3. Select an element on the page or in the **Layers** panel. The **Style** panel shows supported properties; unsupported or unmapped source explains why an action is unavailable.
4. Edit supported styles or text, insert elements, reorder, duplicate, group/unwrap or delete where supported. Double-click opens the source. Undo/redo uses the visual editor history.
5. Review modified editor buffers before saving, or use the explicit autosave option. **Save all** writes pending buffers. The panel can remove the identifiers it added while retaining other edits.

Source rewriting preserves unrelated formatting and checks versions before writing. Editing is tied to the Code Studio session; changing project does not reuse another project's selection. Preview navigation reconnects the design bridge to the newly loaded page.

## Implementation and builds

- Integration and adapters: `frontend/src/features/visual-editor/`.
- Vendored editor/parser/preload modules: its `vendor/` directory, retained under the included Apache-2.0 license. The root Git ignore rules explicitly include this source directory; a clean checkout needs it to build.
- UI: the existing Live Preview toolbar and iframe, with a lazily loaded Design panel and selection overlay.
- In-page bundle: `internal/ide/preview/design.js`, served on demand at `/__adomnia/design.js` and embedded in the Go executable.

After changing the in-page preload sources, run:

```text
cd frontend
npm run build:design-bridge
npm run build
```

Commit the resulting `internal/ide/preview/design.js` with its source changes. The bridge build does not clear the Go output directory.

## Verification boundary

Automated tests cover source identifiers, code-editing actions, formatting preservation, project-path isolation, stale-write handling and on-demand delivery of the design script. TypeScript and production bundling also cover the imported modules. Native desktop acceptance against an actual React development server, including iframe selection, reconnect, source navigation and saving, remains a separate check.
