# P13 — Schema Components (Reusable `$ref` Models) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Add a workspace-level schema registry where users define named JSON Schema models once and reference them via `$ref: "#/components/schemas/ModelName"` in mock bodies (P10), contract validation (P15), and OAS export (P12). A `SchemasPanel.tsx` provides the UI.

**Architecture:** A new `useSchemasStore` (Zustand) persists `SchemaEntry[]` in `localStorage` key `adomnia.schemas`. A `schemaResolver.ts` utility resolves `$ref` paths against the registry. `SchemasPanel.tsx` renders the list + a JSON Schema textarea editor. `WorkspacePanel.tsx` gets a Schemas nav item.

**Prerequisite:** P12 delivered — `oasExport.ts` imports the schema store to emit `components/schemas`.

**Tech Stack:** TypeScript, React, Zustand. No new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/stores/schemas.ts` | **New** — `useSchemasStore`: `SchemaEntry[]`, add/update/remove actions, localStorage persistence |
| `frontend/src/lib/schemaResolver.ts` | **New** — `resolveRefs(schema, registry)` replaces `$ref` with inline schemas |
| `frontend/src/components/workspace/SchemasPanel.tsx` | **New** — list of named schemas + JSON editor |
| `frontend/src/components/workspace/WorkspacePanel.tsx` | Add Schemas nav item linking to `SchemasPanel` |
| `frontend/src/lib/oasExport.ts` | Update `collectionToOAS31` to include `components/schemas` from registry |

---

> **EXECUTION NOTE (2026-06-05):** Adapted to the real codebase:
> - `nanoid` is absent → store uses `uid()` from `@/lib/types`.
> - `safeLocalStorage` exports only `safeSetItem` (no `safeGet`) → reads via `localStorage.getItem` with try/catch.
> - `addSchema` returns the created `SchemaEntry` (cleaner than re-reading store state with `.at(-1)`).
> - **WorkspacePanel has no section nav** (it is a 2-col snapshots/JSON grid). Schemas is instead
>   a first-class **Rail panel** ("Schema Components", under *Local Data & Workspace*), wired in
>   `stores/app.ts` (RailItem union), `MainArea.tsx` (lazy import + case), and `Rail.tsx`.
> - OAS integration is in `collectionsToOAS`/`collectionToOAS` (P12's actual function names), which
>   injects registry schemas into `components.schemas` for both YAML and JSON output.

## Feature Checklist

- [x] **Schema registry store**
  - **AC:** `useSchemasStore` has `schemas: SchemaEntry[]`; `addSchema`, `updateSchema`, `removeSchema` actions; persisted in `adomnia.schemas`
- [x] **Schema resolver**
  - **AC:** `resolveRefs(schema, registry)` replaces `{"$ref": "#/components/schemas/Foo"}` with the inline `Foo` schema from registry; handles nested `$ref`; max depth 10 to prevent circular resolution
- [x] **Schemas panel UI**
  - **AC:** Left list of schema names; right editor with name input + JSON Schema textarea; "New Schema" and "Delete" buttons; save via Ctrl+S or Save button; invalid JSON blocks save
- [x] **OAS export integration**
  - **AC:** `collectionsToOAS`/`collectionToOAS` read `useSchemasStore.getState().schemas` and emit them under `components.schemas` in the output document

---

### Task 1: Create `useSchemasStore`

**Files:**
- Create: `frontend/src/stores/schemas.ts`

- [ ] **Step 1: Define types and store**

  ```ts
  import { create } from 'zustand'
  import { nanoid } from 'nanoid'
  import { safeGet, safeSet } from '@/lib/safeLocalStorage'

  export interface SchemaEntry {
    id: string
    name: string
    schema: string // JSON Schema as a JSON string
    description: string
  }

  const STORAGE_KEY = 'adomnia.schemas'

  function loadSchemas(): SchemaEntry[] {
    try { return JSON.parse(safeGet(STORAGE_KEY) ?? '[]') } catch { return [] }
  }

  interface SchemasState {
    schemas: SchemaEntry[]
    addSchema: (entry: Omit<SchemaEntry, 'id'>) => void
    updateSchema: (id: string, patch: Partial<Omit<SchemaEntry, 'id'>>) => void
    removeSchema: (id: string) => void
  }

  export const useSchemasStore = create<SchemasState>((set, get) => ({
    schemas: loadSchemas(),

    addSchema: (entry) => {
      const next = [...get().schemas, { ...entry, id: nanoid() }]
      set({ schemas: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },

    updateSchema: (id, patch) => {
      const next = get().schemas.map((s) => s.id === id ? { ...s, ...patch } : s)
      set({ schemas: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },

    removeSchema: (id) => {
      const next = get().schemas.filter((s) => s.id !== id)
      set({ schemas: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },
  }))
  ```

  **DoD:**
  - [ ] File created at `frontend/src/stores/schemas.ts`
  - [ ] `useSchemasStore` exported with `schemas`, `addSchema`, `updateSchema`, `removeSchema`
  - [ ] Persisted to/loaded from `adomnia.schemas`
  - [ ] Build passes

- [ ] **Step 2: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/stores/schemas.ts
  git commit -m "feat: add useSchemasStore — schema registry with localStorage persistence"
  ```

  **DoD:**
  - [ ] Build exits 0
  - [ ] Commit created

---

### Task 2: Create `frontend/src/lib/schemaResolver.ts`

**Files:**
- Create: `frontend/src/lib/schemaResolver.ts`

- [ ] **Step 1: Create the file**

  ```ts
  import type { SchemaEntry } from '@/stores/schemas'

  type JSONSchema = Record<string, unknown>

  /**
   * Builds a registry map from SchemaEntry[] for fast $ref lookup.
   * Key format: "#/components/schemas/<name>"
   */
  export function buildRefRegistry(entries: SchemaEntry[]): Map<string, JSONSchema> {
    const map = new Map<string, JSONSchema>()
    for (const entry of entries) {
      try {
        const parsed = JSON.parse(entry.schema) as JSONSchema
        map.set(`#/components/schemas/${entry.name}`, parsed)
      } catch { /* skip invalid schemas */ }
    }
    return map
  }

  /**
   * Recursively resolves $ref references within a JSON Schema using the provided registry.
   * Stops recursion at maxDepth to prevent infinite loops from circular references.
   */
  export function resolveRefs(schema: JSONSchema, registry: Map<string, JSONSchema>, depth = 0): JSONSchema {
    if (depth > 10) return schema

    const ref = schema['$ref']
    if (typeof ref === 'string') {
      const resolved = registry.get(ref)
      if (resolved) {
        return resolveRefs(resolved, registry, depth + 1)
      }
      return schema // unresolved ref — return as-is
    }

    const result: JSONSchema = {}
    for (const [key, value] of Object.entries(schema)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = resolveRefs(value as JSONSchema, registry, depth + 1)
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          item !== null && typeof item === 'object' && !Array.isArray(item)
            ? resolveRefs(item as JSONSchema, registry, depth + 1)
            : item
        )
      } else {
        result[key] = value
      }
    }
    return result
  }
  ```

  **DoD:**
  - [ ] `buildRefRegistry(entries)` returns `Map<string, JSONSchema>` keyed by `#/components/schemas/<name>`
  - [ ] `resolveRefs(schema, registry)` replaces `{"$ref": "..."}` with the inline schema
  - [ ] Nested `$ref` resolved recursively up to depth 10
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/lib/schemaResolver.ts
  git commit -m "feat: add schemaResolver — resolveRefs for $ref resolution against schema registry"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 3: Create `SchemasPanel.tsx`

**Files:**
- Create: `frontend/src/components/workspace/SchemasPanel.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
  import { useState } from 'react'
  import { Plus, Trash2, Save } from 'lucide-react'
  import { useSchemasStore, type SchemaEntry } from '@/stores/schemas'
  import { cn } from '@/lib/utils'

  const STARTER_SCHEMA = JSON.stringify({
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  }, null, 2)

  export function SchemasPanel() {
    const { schemas, addSchema, updateSchema, removeSchema } = useSchemasStore()
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')
    const [editDesc, setEditDesc] = useState('')
    const [editSchema, setEditSchema] = useState('')
    const [jsonError, setJsonError] = useState('')

    const selected = schemas.find((s) => s.id === selectedId) ?? null

    const selectSchema = (entry: SchemaEntry) => {
      setSelectedId(entry.id)
      setEditName(entry.name)
      setEditDesc(entry.description)
      setEditSchema(entry.schema)
      setJsonError('')
    }

    const handleNew = () => {
      addSchema({ name: 'NewModel', schema: STARTER_SCHEMA, description: '' })
      const added = useSchemasStore.getState().schemas.at(-1)
      if (added) selectSchema(added)
    }

    const handleSave = () => {
      if (!selectedId) return
      try {
        JSON.parse(editSchema)
        setJsonError('')
      } catch (e) {
        setJsonError(String(e))
        return
      }
      updateSchema(selectedId, { name: editName, description: editDesc, schema: editSchema })
    }

    const handleDelete = (id: string) => {
      removeSchema(id)
      if (selectedId === id) {
        setSelectedId(null)
        setEditName('')
        setEditDesc('')
        setEditSchema('')
      }
    }

    return (
      <div className="flex h-full overflow-hidden">
        {/* Left: schema list */}
        <div className="w-[180px] border-r border-border-1 flex flex-col bg-surface-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-1">
            <span className="text-[10px] font-semibold text-text-3 uppercase tracking-wider">Schemas</span>
            <button onClick={handleNew} className="p-0.5 rounded hover:bg-surface-2 text-text-4 hover:text-text-1 transition-colors">
              <Plus size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {schemas.map((s) => (
              <div
                key={s.id}
                onClick={() => selectSchema(s)}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] transition-colors',
                  selectedId === s.id ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2'
                )}
              >
                <span className="flex-1 truncate font-mono">{s.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 text-text-4 hover:text-red-400 transition-all shrink-0"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
            {schemas.length === 0 && (
              <p className="px-3 py-4 text-[10px] text-text-4 text-center">No schemas.<br />Click + to add one.</p>
            )}
          </div>
        </div>

        {/* Right: editor */}
        {selected ? (
          <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-medium text-text-2 block mb-1">Name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-7 px-2 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
                />
              </div>
              <button
                onClick={handleSave}
                className="mt-5 h-7 px-3 flex items-center gap-1.5 text-[10px] bg-accent text-white rounded hover:bg-accent/90 transition-colors"
              >
                <Save size={11} />
                Save
              </button>
            </div>
            <div>
              <label className="text-[10px] font-medium text-text-2 block mb-1">Description</label>
              <input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Optional description"
                className="w-full h-7 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
              />
            </div>
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-medium text-text-2">JSON Schema</label>
                <span className="text-[9px] text-text-4">Reference: <code className="font-mono text-accent">#/components/schemas/{editName}</code></span>
              </div>
              <textarea
                value={editSchema}
                onChange={(e) => { setEditSchema(e.target.value); setJsonError('') }}
                className="flex-1 px-2 py-1.5 text-[10px] font-mono bg-surface-1 border border-border-2 rounded text-text-1 focus:border-accent outline-none resize-none"
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() } }}
              />
              {jsonError && <p className="text-[9px] text-red-400 mt-1">{jsonError}</p>}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[10px] text-text-4">
            Select a schema to edit it, or click + to create one.
          </div>
        )}
      </div>
    )
  }
  ```

  **DoD:**
  - [ ] File created at `frontend/src/components/workspace/SchemasPanel.tsx`
  - [ ] Left pane: schema list with add/delete
  - [ ] Right pane: name + description + JSON Schema textarea + Save button
  - [ ] `$ref` path shown below schema name for easy copy
  - [ ] Ctrl+S saves
  - [ ] Invalid JSON shown as error (does not save)
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/components/workspace/SchemasPanel.tsx
  git commit -m "feat: add SchemasPanel — schema registry UI with name editor and JSON Schema textarea"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 4: Add Schemas nav item to `WorkspacePanel.tsx`

**Files:**
- Modify: `frontend/src/components/workspace/WorkspacePanel.tsx`

- [ ] **Step 1: Import and mount `SchemasPanel`**

  ```tsx
  import { SchemasPanel } from './SchemasPanel'
  ```

  Add a "Schemas" nav item (with `DatabaseZap` or `Layers` icon from lucide-react) and a render branch:

  ```tsx
  // In nav items:
  <button onClick={() => setSection('schemas')} ...>
    <Layers size={13} />
    Schemas
  </button>

  // In content area:
  {section === 'schemas' && <SchemasPanel />}
  ```

  **DoD:**
  - [ ] "Schemas" nav item visible in WorkspacePanel sidebar
  - [ ] Clicking it renders `SchemasPanel`
  - [ ] Build passes

- [ ] **Step 2: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/components/workspace/WorkspacePanel.tsx
  git commit -m "feat: workspace — add Schemas section linking to SchemasPanel"
  ```

  **DoD:**
  - [ ] Build exits 0
  - [ ] Commit created

---

### Task 5: Update `oasExport.ts` to include schema registry

**Files:**
- Modify: `frontend/src/lib/oasExport.ts`

- [ ] **Step 1: Import and use `useSchemasStore`**

  In `oasExport.ts`, add to `collectionToOAS31`:

  ```ts
  import { useSchemasStore } from '@/stores/schemas'
  // ...
  // Inside collectionToOAS31, after building doc.paths:
  const registrySchemas = useSchemasStore.getState().schemas
  if (registrySchemas.length > 0) {
    const schemasComponents: Record<string, unknown> = {}
    for (const entry of registrySchemas) {
      try {
        schemasComponents[entry.name] = JSON.parse(entry.schema)
      } catch { /* skip invalid */ }
    }
    doc.components = { ...doc.components, schemas: { ...(doc.components?.schemas ?? {}), ...schemasComponents } }
  }
  ```

  **DoD:**
  - [ ] When the schema registry has entries, `components/schemas` in exported OAS contains all registered schemas
  - [ ] Existing export behavior unchanged when registry is empty
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/lib/oasExport.ts
  git commit -m "feat: oasExport — include useSchemasStore schemas in components/schemas of OAS export"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 6: Full smoke test

- [ ] **Step 1: Build verification**

  ```bash
  go build ./... && cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [ ] Both exit 0

- [ ] **Step 2: Manual smoke test**

  Run `wails dev`. Go to Workspace → Schemas. Verify:

  **DoD:**
  - [ ] "New Schema" creates an entry with the starter schema
  - [ ] Editing name + schema and saving persists across navigation
  - [ ] `$ref` path shown correctly below name
  - [ ] Export a collection (from P12) → YAML contains `components.schemas` with the defined schema
  - [ ] Creating a schema with invalid JSON shows an error and does not save
