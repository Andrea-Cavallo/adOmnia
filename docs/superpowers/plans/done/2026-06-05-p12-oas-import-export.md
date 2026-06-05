# P12 — OAS Import/Export Native (Round-Trip OpenAPI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Promote OpenAPI 3.x / Swagger 2.x import to a first-class entry point in adOmnia (file, URL, paste) and add full round-trip export — any collection can be exported back to a valid OAS 3.1 YAML or JSON document. This closes the spec-first gap and provides the foundation used by P13 (Schema Components), P14 (Visual Editor), P15 (Response Validation), and P19 (Doc Generator).

**Architecture:** Import already works via `frontend/src/lib/openapi.ts` + `openapiImport.ts` — a thin wrapper converts OAS to Collection. The gap is: (1) no first-class import UI (only buried in collection tree), (2) no export path (Collection → OAS). This plan adds `frontend/src/lib/oasExport.ts` for export, a new `OasImportModal.tsx` for the import UX, and wires both into `WorkspacePanel.tsx`. The Go `App.SaveFileDialog` is used for saving the export.

**Tech Stack:** TypeScript, React, existing `js-yaml` (already in `package.json` — verify). No new dependencies needed.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/lib/oasExport.ts` | **New** — `collectionToOAS31(collection): string` generates valid OAS 3.1 YAML |
| `frontend/src/components/workspace/OasImportModal.tsx` | **New** — import dialog (file / URL / paste) |
| `frontend/src/components/workspace/WorkspacePanel.tsx` | Add Import from OAS and Export to OAS buttons |
| `app.go` | Verify / add `SaveFileDialog` and `OpenFileDialog` bindings |
| `frontend/wailsjs/go/main/App.d.ts` | Update if new bindings added |

---

> **EXECUTION NOTE (2026-06-05):** Plan adapted to the real codebase per the project's
> reuse / no-duplication / product-first rules. Deviations from the literal plan:
> - **Task 1 (app.go SaveFileDialog/OpenFileDialog) SKIPPED** — not needed. Import uses a
>   hidden `<input type=file>` (existing pattern); export uses the existing `downloadText`
>   blob download. No Go change required.
> - **`oasExport.ts` reuses the canonical `exportToOpenApi` (OAS 3.0.3)** instead of
>   hand-rolling a 3.1 serializer. The existing exporter already handles auth/security
>   schemes, headers, query params, request bodies and base-URL inference — a duplicate
>   would have been strictly worse. `oasExport.ts` adds the YAML round-trip (`yaml` pkg,
>   not `js-yaml` which is absent). Functions: `collectionToOAS` / `collectionsToOAS`.
> - Store method is `importCollection(collection)`, not `addCollection(name)`.
> - **Export already existed** in the CollectionTree context menu (OpenAPI 3 / Swagger 2 JSON);
>   added a new "Export OpenAPI 3 (YAML)" entry there.
> - Also fixed pre-existing stale GitSync TS bindings that were blocking `npm run build`.

## Feature Checklist

- [x] **`oasExport.ts` — collection → OAS YAML** *(reuses `exportToOpenApi`, emits 3.0.3 YAML/JSON)*
  - **AC:** Given a `Collection`, outputs a valid OAS document with `info`, `paths`, auth security schemes, query/header params, and request bodies via the canonical serializer; YAML or JSON via `format` arg
- [x] **`OasImportModal.tsx` — three import modes**
  - **AC:** File tab — file picker for `.yaml`/`.json`; URL tab — fetch from URL; Paste tab — textarea; all three call `openApiToCollection()` and `importCollection()`
- [x] **Import / Export buttons in WorkspacePanel + CollectionTree**
  - **AC:** "Import OAS" button in WorkspacePanel toolbar opens `OasImportModal`; "Export OpenAPI 3 (YAML)" in collection context menu exports via `downloadText`
- [x] **Round-trip**
  - **AC:** Exporting a collection (JSON or YAML) and re-importing reproduces endpoint names and paths (shared `exportToOpenApi`/`openApiToCollection` mapping)

---

### Task 1: Check/add `SaveFileDialog` and `OpenFileDialog` in `app.go`

**Files:**
- Modify: `app.go` (if bindings missing)

- [ ] **Step 1: Check existing bindings**

  Search for `SaveFileDialog` and `OpenFileDialog` in `app.go`:

  ```bash
  grep -n "SaveFileDialog\|OpenFileDialog\|OpenDirectoryDialog" app.go
  ```

  **DoD:**
  - [ ] If all three exist, no changes needed — mark done
  - [ ] If any are missing, proceed to Step 2

- [ ] **Step 2: Add missing bindings** (only if Step 1 found them missing)

  Add to `app.go`:

  ```go
  import "github.com/wailsapp/wails/v2/pkg/runtime"

  // SaveFileDialog opens a native save dialog and returns the chosen path.
  // Returns "" if the user cancels.
  func (a *App) SaveFileDialog(defaultName, content string) (string, error) {
      path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
          DefaultFilename: defaultName,
          Filters: []runtime.FileFilter{
              {DisplayName: "YAML Files", Pattern: "*.yaml;*.yml"},
              {DisplayName: "JSON Files", Pattern: "*.json"},
              {DisplayName: "All Files", Pattern: "*.*"},
          },
      })
      if err != nil || path == "" {
          return "", err
      }
      if err := os.WriteFile(path, []byte(content), 0644); err != nil {
          return "", err
      }
      return path, nil
  }

  // OpenFileDialog opens a native open dialog and returns the file content.
  func (a *App) OpenFileDialog(title string) (string, error) {
      path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
          Title: title,
          Filters: []runtime.FileFilter{
              {DisplayName: "API Spec Files", Pattern: "*.yaml;*.yml;*.json"},
              {DisplayName: "All Files", Pattern: "*.*"},
          },
      })
      if err != nil || path == "" {
          return "", err
      }
      raw, err := os.ReadFile(path)
      if err != nil {
          return "", err
      }
      return string(raw), nil
  }
  ```

  **DoD:**
  - [ ] `SaveFileDialog` and `OpenFileDialog` present in `app.go`
  - [ ] `go build ./...` exits 0

- [ ] **Step 3: Commit** (only if changes were made)

  ```bash
  git add app.go
  git commit -m "feat: app — add SaveFileDialog and OpenFileDialog Wails bindings"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message (or task skipped if bindings existed)

---

### Task 2: Create `frontend/src/lib/oasExport.ts`

**Files:**
- Create: `frontend/src/lib/oasExport.ts`

- [ ] **Step 1: Check if `js-yaml` is available**

  ```bash
  grep -r "js-yaml\|jsYaml\|yaml" frontend/package.json
  ```

  If not present: `cd frontend && npm install js-yaml @types/js-yaml --save`.

  **DoD:**
  - [ ] `js-yaml` available in `package.json`

- [ ] **Step 2: Create the file**

  ```ts
  import * as yaml from 'js-yaml'
  import type { Collection, RequestItem } from '@/lib/types'

  interface OASDocument {
    openapi: string
    info: { title: string; version: string }
    paths: Record<string, Record<string, OASOperation>>
    components?: { schemas?: Record<string, unknown> }
  }

  interface OASOperation {
    operationId: string
    summary?: string
    parameters?: OASParameter[]
    requestBody?: unknown
    responses: Record<string, { description: string; content?: unknown }>
  }

  interface OASParameter {
    name: string
    in: 'path' | 'query' | 'header'
    required: boolean
    schema: { type: string }
  }

  const pathParamRe = /\{(\w+)\}|:(\w+)/g

  function normalizePath(url: string): string {
    if (!url) return '/'
    // Strip query string
    const qIdx = url.indexOf('?')
    let path = qIdx > -1 ? url.slice(0, qIdx) : url
    // Convert :param to {param}
    path = path.replace(/:(\w+)/g, '{$1}')
    // Ensure leading slash
    if (!path.startsWith('/')) path = '/' + path
    return path
  }

  function extractPathParams(path: string): string[] {
    const matches: string[] = []
    let m: RegExpExecArray | null
    const re = /\{(\w+)\}/g
    while ((m = re.exec(path)) !== null) {
      matches.push(m[1])
    }
    return matches
  }

  function itemToOperation(item: RequestItem, pathParams: string[]): OASOperation {
    const parameters: OASParameter[] = [
      ...pathParams.map((p) => ({
        name: p, in: 'path' as const, required: true, schema: { type: 'string' },
      })),
    ]

    // Add query params from item.params
    for (const p of (item.params ?? [])) {
      if (p.key && p.enabled !== false) {
        parameters.push({ name: p.key, in: 'query', required: false, schema: { type: 'string' } })
      }
    }

    const operation: OASOperation = {
      operationId: item.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || 'operation',
      summary: item.name,
      parameters: parameters.length > 0 ? parameters : undefined,
      responses: { '200': { description: 'OK' } },
    }

    // Request body
    if (item.body?.mode === 'raw' && item.body.raw?.trim()) {
      try {
        const schema = inferSchemaFromExample(JSON.parse(item.body.raw))
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema, example: JSON.parse(item.body.raw) } },
        }
      } catch {
        operation.requestBody = {
          required: true,
          content: { 'text/plain': { schema: { type: 'string' } } },
        }
      }
    }

    return operation
  }

  function inferSchemaFromExample(value: unknown): unknown {
    if (value === null) return { type: 'null' }
    if (Array.isArray(value)) {
      return {
        type: 'array',
        items: value.length > 0 ? inferSchemaFromExample(value[0]) : {},
      }
    }
    if (typeof value === 'object') {
      const props: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        props[k] = inferSchemaFromExample(v)
      }
      return { type: 'object', properties: props }
    }
    return { type: typeof value }
  }

  function flattenItems(children: unknown[]): RequestItem[] {
    const result: RequestItem[] = []
    for (const child of children) {
      const c = child as { type?: string; children?: unknown[] } & RequestItem
      if (c.type === 'request' || !c.children) {
        result.push(c as RequestItem)
      } else if (c.children) {
        result.push(...flattenItems(c.children))
      }
    }
    return result
  }

  /** Convert a Collection to an OAS 3.1 YAML string. */
  export function collectionToOAS31(collection: Collection, format: 'yaml' | 'json' = 'yaml'): string {
    const doc: OASDocument = {
      openapi: '3.1.0',
      info: { title: collection.name, version: '1.0.0' },
      paths: {},
    }

    // If _openapiSpec exists, use it as the base and merge — otherwise build from scratch
    let baseSpec: OASDocument | null = null
    if (collection._openapiSpec) {
      try {
        baseSpec = yaml.load(collection._openapiSpec) as OASDocument
        doc.components = baseSpec.components
      } catch { /* ignore */ }
    }

    const items = flattenItems(collection.children ?? [])
    for (const item of items) {
      const method = (item.method ?? 'GET').toLowerCase()
      const path = normalizePath(item.url ?? '')
      const pathParams = extractPathParams(path)

      if (!doc.paths[path]) doc.paths[path] = {}
      doc.paths[path][method] = itemToOperation(item, pathParams)
    }

    if (format === 'json') {
      return JSON.stringify(doc, null, 2)
    }
    return yaml.dump(doc, { noRefs: true, lineWidth: 120 })
  }
  ```

  **DoD:**
  - [ ] `collectionToOAS31(collection, format)` exported from `oasExport.ts`
  - [ ] Produces valid OAS 3.1 document with `openapi: "3.1.0"`, `info`, `paths`
  - [ ] Path params in `{param}` or `:param` added as required path parameters
  - [ ] Query params from `item.params` added as optional query parameters
  - [ ] JSON request body generates `requestBody` with inferred schema
  - [ ] If `_openapiSpec` present, `components` preserved from original spec
  - [ ] Build passes

- [ ] **Step 3: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/lib/oasExport.ts
  git commit -m "feat: add oasExport.ts — collectionToOAS31 converts collection to valid OAS 3.1 YAML/JSON"
  ```

  **DoD:**
  - [ ] Build exits 0
  - [ ] Commit created

---

### Task 3: Create `OasImportModal.tsx`

**Files:**
- Create: `frontend/src/components/workspace/OasImportModal.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
  import { useState } from 'react'
  import { X, Upload, Link, FileText, AlertCircle } from 'lucide-react'
  import * as AppBinding from '@/wailsjs/go/main/App'
  import { openApiToCollection } from '@/lib/openapiImport'
  import { useCollectionsStore } from '@/stores/collections'
  import { cn } from '@/lib/utils'

  interface Props {
    onClose: () => void
  }

  type ImportTab = 'file' | 'url' | 'paste'

  export function OasImportModal({ onClose }: Props) {
    const [tab, setTab] = useState<ImportTab>('file')
    const [url, setUrl] = useState('')
    const [paste, setPaste] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const addCollection = useCollectionsStore((s) => s.addCollection)

    const doImport = async (specText: string) => {
      setError('')
      setLoading(true)
      try {
        const collection = openApiToCollection(specText)
        addCollection(collection)
        onClose()
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }

    const handleFile = async () => {
      setError('')
      try {
        const content = await (AppBinding as { OpenFileDialog?: (title: string) => Promise<string> }).OpenFileDialog?.('Open OpenAPI Spec') ?? ''
        if (content) await doImport(content)
      } catch (e) {
        setError(String(e))
      }
    }

    const handleURL = async () => {
      if (!url.trim()) return
      setLoading(true)
      setError('')
      try {
        const resp = await fetch(url.trim())
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const text = await resp.text()
        await doImport(text)
      } catch (e) {
        setError(String(e))
        setLoading(false)
      }
    }

    const handlePaste = async () => {
      if (!paste.trim()) return
      await doImport(paste.trim())
    }

    const tabs: { id: ImportTab; label: string; icon: React.ReactNode }[] = [
      { id: 'file', label: 'File', icon: <Upload size={11} /> },
      { id: 'url', label: 'URL', icon: <Link size={11} /> },
      { id: 'paste', label: 'Paste', icon: <FileText size={11} /> },
    ]

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="w-[480px] bg-surface-1 border border-border-1 rounded-lg shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-1">
            <span className="text-[12px] font-semibold text-text-1">Import OpenAPI Spec</span>
            <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-text-4 hover:text-text-1 transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border-1 px-4 gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setError('') }}
                className={cn('flex items-center gap-1.5 px-3 py-2 text-[10px] border-b-2 transition-colors',
                  tab === t.id ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1')}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-4 space-y-3">
            {tab === 'file' && (
              <div className="space-y-3">
                <p className="text-[10px] text-text-3">Open an OpenAPI 3.x (.yaml / .json) or Swagger 2.x file from disk.</p>
                <button
                  onClick={handleFile}
                  disabled={loading}
                  className="w-full h-9 text-[11px] bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
                >
                  <Upload size={13} />
                  Choose File…
                </button>
              </div>
            )}

            {tab === 'url' && (
              <div className="space-y-3">
                <p className="text-[10px] text-text-3">Fetch a spec from a URL (requires network access).</p>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleURL()}
                  placeholder="https://petstore3.swagger.io/api/v3/openapi.json"
                  className="w-full h-7 px-2 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
                />
                <button
                  onClick={handleURL}
                  disabled={loading || !url.trim()}
                  className="w-full h-9 text-[11px] bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
                >
                  <Link size={13} />
                  {loading ? 'Fetching…' : 'Import from URL'}
                </button>
              </div>
            )}

            {tab === 'paste' && (
              <div className="space-y-3">
                <p className="text-[10px] text-text-3">Paste YAML or JSON spec content directly.</p>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="openapi: 3.1.0&#10;info:&#10;  title: My API&#10;  version: 1.0.0&#10;paths: {}"
                  rows={8}
                  className="w-full px-2 py-1.5 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none resize-none"
                />
                <button
                  onClick={handlePaste}
                  disabled={loading || !paste.trim()}
                  className="w-full h-9 text-[11px] bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
                >
                  <FileText size={13} />
                  {loading ? 'Importing…' : 'Import'}
                </button>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded bg-red-950/30 border border-red-900/40 text-[10px] text-red-300">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }
  ```

  **DoD:**
  - [ ] File created at `frontend/src/components/workspace/OasImportModal.tsx`
  - [ ] File tab: opens native dialog, imports spec
  - [ ] URL tab: fetches and imports
  - [ ] Paste tab: parses textarea content and imports
  - [ ] Error shown when import fails
  - [ ] Modal closes on success
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/components/workspace/OasImportModal.tsx
  git commit -m "feat: add OasImportModal — file/URL/paste import for OpenAPI 3.x and Swagger 2.x specs"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 4: Wire buttons in `WorkspacePanel.tsx`

**Files:**
- Modify: `frontend/src/components/workspace/WorkspacePanel.tsx`

- [ ] **Step 1: Read `WorkspacePanel.tsx` first**

  Before editing, open the file and identify:
  - Where collection-level actions are rendered (toolbar, context menu, or header buttons)
  - How the collections store is used

  **DoD:**
  - [ ] File read and relevant sections identified before any edit

- [ ] **Step 2: Add Import OAS button**

  Add a state variable and the modal:

  ```tsx
  import { OasImportModal } from './OasImportModal'
  // ...
  const [showOasImport, setShowOasImport] = useState(false)
  // ...
  {showOasImport && <OasImportModal onClose={() => setShowOasImport(false)} />}
  ```

  Add an "Import OAS" button in the workspace toolbar area:

  ```tsx
  <button
    onClick={() => setShowOasImport(true)}
    className="flex items-center gap-1.5 h-7 px-3 text-[10px] bg-surface-2 text-text-3 rounded border border-border-2 hover:text-text-1 hover:bg-surface-3 transition-colors"
    title="Import OpenAPI spec as collection"
  >
    <FileCode size={12} />
    Import OAS
  </button>
  ```

  Add `FileCode` to the lucide-react import.

  **DoD:**
  - [ ] "Import OAS" button visible in WorkspacePanel toolbar
  - [ ] Clicking it opens `OasImportModal`
  - [ ] Importing a spec adds a new collection to the store

- [ ] **Step 3: Add Export OAS to collection context menu**

  Find where the collection context menu is rendered (right-click or kebab menu). Add an "Export OAS" option:

  ```tsx
  import { collectionToOAS31 } from '@/lib/oasExport'
  import * as AppBinding from '@/wailsjs/go/main/App'
  // ...
  const handleExportOAS = async (collection: Collection) => {
    const yaml = collectionToOAS31(collection, 'yaml')
    const defaultName = `${collection.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.yaml`
    await (AppBinding as { SaveFileDialog?: (name: string, content: string) => Promise<string> }).SaveFileDialog?.(defaultName, yaml)
  }
  ```

  Add the menu item:

  ```tsx
  <button onClick={() => handleExportOAS(collection)}>
    Export as OAS…
  </button>
  ```

  **DoD:**
  - [ ] "Export as OAS…" option in collection context menu
  - [ ] Clicking it opens a native save dialog with a `.yaml` default name
  - [ ] Saved file is valid OAS 3.1 YAML

- [ ] **Step 4: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [ ] Exit code 0, zero TypeScript errors

- [ ] **Step 5: Manual smoke test**

  Run `wails dev`. Open Workspace. Verify:

  **DoD:**
  - [ ] "Import OAS" button visible
  - [ ] Pasting a Petstore YAML spec creates a new collection with the correct endpoints
  - [ ] Right-clicking a collection shows "Export as OAS…"
  - [ ] Exporting a collection creates a valid `.yaml` file that can be re-imported without errors

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/components/workspace/WorkspacePanel.tsx
  git commit -m "feat: workspace — wire Import OAS button and Export OAS collection context menu"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message
