# P14 — Visual OpenAPI Editor (Form-Based Spec Authoring) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** A form-based OpenAPI endpoint editor where users define API operations (method, path, parameters, request body, responses) without writing YAML. Changes sync back to the collection's `_openapiSpec` via `oasExport.ts`. Accessible from the existing `apis` panel or as a dedicated section in `WorkspacePanel`.

**Architecture:** `ApiEditorPanel.tsx` shows a list of endpoints derived from the collection's stored spec (or from the requests themselves). `EndpointFormEditor.tsx` provides the per-endpoint form. On save, it updates the collection in the store via `_openapiSpec`. Relies on P12 (`oasExport.ts`) for round-trip and P13 (`schemaResolver.ts`) for `$ref` support.

**Prerequisites:** P12 (oasExport.ts), P13 (schemaResolver.ts, SchemasPanel).

**Tech Stack:** TypeScript, React, Zustand. No new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/components/apis/ApiEditorPanel.tsx` | **New** — endpoint list + form editor shell |
| `frontend/src/components/apis/EndpointFormEditor.tsx` | **New** — per-endpoint form: method, path, params, body, responses |
| `frontend/src/components/apis/ParameterTable.tsx` | **New** — editable parameter rows component |
| `frontend/src/components/workspace/WorkspacePanel.tsx` | Add "API Editor" nav item |
| `frontend/src/stores/collections.ts` | Verify `updateCollection` exists and accepts `_openapiSpec` patch |

---

> **EXECUTION NOTE (2026-06-05):** Adapted to the real codebase:
> - `updateCollection(id, patch)` was **missing** → added to `collections.ts`.
> - `js-yaml` is absent and `collectionToOAS31` doesn't exist → uses the `yaml` package and
>   P12's `collectionToOAS`.
> - **WorkspacePanel has no section nav** → API Editor is a first-class **Rail panel**
>   (API Core › Design), wired in `stores/app.ts`, `MainArea.tsx`, `Rail.tsx`.
> - **Improved over the plan:** the plan's `handleSave` had a TODO that discarded form edits.
>   This implementation does a **real merge** — `endpointDefToOperation` builds the OAS operation
>   and writes it into the parsed spec's `paths`, handling method/path rename (drops the old op)
>   and add. Method badges use the app's `--color-method-*` tokens for cohesion.
> - Endpoint list derives from `_openapiSpec` when present, otherwise synthesizes a spec from the
>   collection's requests via `collectionToOAS`.

## Feature Checklist

- [x] **Endpoint list**
  - **AC:** Left pane shows all endpoints for the selected collection (from `_openapiSpec`, else synthesized from requests); each entry shows method badge + path
- [x] **Per-endpoint form**
  - **AC:** Method selector; path input; Parameters tables (path/query/header: name, in, required, type, description); Request Body toggle + content-type + schema textarea; Responses (status code, description, schema `$ref` or inline)
- [x] **Sync to collection spec**
  - **AC:** "Save" merges the edited operation into `_openapiSpec` and calls `updateCollection`; the updated spec is immediately available for export (P12) / validation (P15) / docs
- [x] **Add / rename endpoint**
  - **AC:** "New Endpoint" adds a blank `/new-endpoint` GET op; changing method/path on save renames in place (old op removed)

---

### Task 1: Verify `updateCollection` in `collections.ts`

**Files:**
- Read: `frontend/src/stores/collections.ts`

- [ ] **Step 1: Check `updateCollection` existence**

  ```bash
  grep -n "updateCollection\|patchCollection" frontend/src/stores/collections.ts
  ```

  **DoD:**
  - [ ] If `updateCollection(id, patch)` exists — no changes needed, mark done
  - [ ] If missing — proceed to Step 2

- [ ] **Step 2: Add `updateCollection` if missing** (only if Step 1 found it missing)

  In `collections.ts`, add to the state interface:

  ```ts
  updateCollection: (id: string, patch: Partial<Collection>) => void
  ```

  And implementation:

  ```ts
  updateCollection: (id, patch) => {
    set((s) => ({
      collections: s.collections.map((c) => c.id === id ? { ...c, ...patch } : c),
    }))
    get().save()
  },
  ```

  **DoD:**
  - [ ] `updateCollection(id, patch)` present in store
  - [ ] Build passes

- [ ] **Step 3: Commit** (only if changes made)

  ```bash
  git add frontend/src/stores/collections.ts
  git commit -m "feat: collections — add updateCollection action for patching collection fields"
  ```

---

### Task 2: Create `ParameterTable.tsx`

**Files:**
- Create: `frontend/src/components/apis/ParameterTable.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
  import { Plus, Trash2 } from 'lucide-react'
  import { cn } from '@/lib/utils'

  export interface OASParam {
    name: string
    in: 'path' | 'query' | 'header'
    required: boolean
    type: string
    description: string
  }

  interface Props {
    params: OASParam[]
    onChange: (params: OASParam[]) => void
    disableInChange?: boolean // true for path params (in = path, required = true always)
  }

  const BLANK: OASParam = { name: '', in: 'query', required: false, type: 'string', description: '' }

  export function ParameterTable({ params, onChange, disableInChange }: Props) {
    const add = () => onChange([...params, { ...BLANK }])
    const remove = (i: number) => onChange(params.filter((_, idx) => idx !== i))
    const update = (i: number, patch: Partial<OASParam>) =>
      onChange(params.map((p, idx) => idx === i ? { ...p, ...patch } : p))

    return (
      <div className="space-y-1.5">
        {params.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-wrap">
            <input
              value={p.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="name"
              className="h-6 px-2 text-[9px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none w-[90px]"
            />
            {!disableInChange ? (
              <select
                value={p.in}
                onChange={(e) => update(i, { in: e.target.value as OASParam['in'] })}
                className="h-6 px-1.5 text-[9px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
              >
                <option value="query">query</option>
                <option value="header">header</option>
                <option value="path">path</option>
              </select>
            ) : (
              <span className="h-6 px-2 text-[9px] font-mono bg-surface-1 border border-border-1 rounded text-text-4 flex items-center">path</span>
            )}
            <select
              value={p.type}
              onChange={(e) => update(i, { type: e.target.value })}
              className="h-6 px-1.5 text-[9px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
            >
              <option value="string">string</option>
              <option value="integer">integer</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            {!disableInChange && (
              <label className="flex items-center gap-1 text-[9px] text-text-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={p.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                  className="w-3 h-3 accent-[var(--color-accent)]"
                />
                required
              </label>
            )}
            <input
              value={p.description}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder="description"
              className="h-6 px-2 text-[9px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none flex-1 min-w-[80px]"
            />
            <button
              onClick={() => remove(i)}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-surface-3 text-text-4 hover:text-red-400 transition-colors shrink-0"
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
        <button
          onClick={add}
          className="flex items-center gap-1.5 h-6 px-2 text-[9px] text-text-3 hover:text-text-1 hover:bg-surface-2 rounded transition-colors"
        >
          <Plus size={11} />
          Add parameter
        </button>
      </div>
    )
  }
  ```

  **DoD:**
  - [ ] File created at `frontend/src/components/apis/ParameterTable.tsx`
  - [ ] Add/remove parameter rows
  - [ ] name/in/type/required/description fields
  - [ ] `disableInChange` locks `in` to `path` for path params
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/components/apis/ParameterTable.tsx
  git commit -m "feat: api-editor — add ParameterTable component for OAS parameter editing"
  ```

---

### Task 3: Create `EndpointFormEditor.tsx`

**Files:**
- Create: `frontend/src/components/apis/EndpointFormEditor.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
  import { useState, useEffect } from 'react'
  import { Save } from 'lucide-react'
  import { ParameterTable, type OASParam } from './ParameterTable'
  import { cn } from '@/lib/utils'

  export interface EndpointDef {
    method: string
    path: string
    summary: string
    description: string
    pathParams: OASParam[]
    queryParams: OASParam[]
    headerParams: OASParam[]
    hasRequestBody: boolean
    requestBodyContentType: string
    requestBodySchema: string
    responses: ResponseDef[]
  }

  export interface ResponseDef {
    statusCode: string
    description: string
    schema: string
  }

  interface Props {
    endpoint: EndpointDef
    onSave: (updated: EndpointDef) => void
  }

  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  const METHOD_COLORS: Record<string, string> = {
    GET: 'bg-blue-900/30 text-blue-300',
    POST: 'bg-green-900/30 text-green-300',
    PUT: 'bg-yellow-900/30 text-yellow-300',
    PATCH: 'bg-orange-900/30 text-orange-300',
    DELETE: 'bg-red-900/30 text-red-300',
    HEAD: 'bg-surface-2 text-text-4',
    OPTIONS: 'bg-surface-2 text-text-4',
  }

  type EditorTab = 'parameters' | 'body' | 'responses'

  export function EndpointFormEditor({ endpoint, onSave }: Props) {
    const [form, setForm] = useState<EndpointDef>(endpoint)
    const [tab, setTab] = useState<EditorTab>('parameters')

    useEffect(() => { setForm(endpoint) }, [endpoint])

    const update = (patch: Partial<EndpointDef>) => setForm((f) => ({ ...f, ...patch }))

    const addResponse = () =>
      update({ responses: [...form.responses, { statusCode: '200', description: 'OK', schema: '' }] })
    const removeResponse = (i: number) =>
      update({ responses: form.responses.filter((_, idx) => idx !== i) })
    const updateResponse = (i: number, patch: Partial<ResponseDef>) =>
      update({ responses: form.responses.map((r, idx) => idx === i ? { ...r, ...patch } : r) })

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Method + Path */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1 bg-surface-1">
          <select
            value={form.method}
            onChange={(e) => update({ method: e.target.value })}
            className={cn('h-7 px-2 text-[10px] font-mono font-bold rounded border border-border-2 focus:border-accent outline-none', METHOD_COLORS[form.method] ?? 'bg-surface-2 text-text-2')}
          >
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input
            value={form.path}
            onChange={(e) => update({ path: e.target.value })}
            placeholder="/api/users/{id}"
            className="flex-1 h-7 px-2 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
          />
          <button
            onClick={() => onSave(form)}
            className="h-7 px-3 flex items-center gap-1.5 text-[10px] bg-accent text-white rounded hover:bg-accent/90 transition-colors"
          >
            <Save size={11} />
            Save
          </button>
        </div>

        {/* Summary / description */}
        <div className="px-4 py-2 border-b border-border-1 space-y-2">
          <input
            value={form.summary}
            onChange={(e) => update({ summary: e.target.value })}
            placeholder="Summary (short description)"
            className="w-full h-6 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
          />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-1 px-4 gap-1">
          {(['parameters', 'body', 'responses'] as EditorTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn('px-3 py-2 text-[10px] capitalize font-medium border-b-2 transition-colors',
                tab === t ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1')}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {tab === 'parameters' && (
            <>
              {form.pathParams.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-text-2 mb-2">Path Parameters</p>
                  <ParameterTable params={form.pathParams} onChange={(p) => update({ pathParams: p })} disableInChange />
                </div>
              )}
              <div>
                <p className="text-[10px] font-medium text-text-2 mb-2">Query Parameters</p>
                <ParameterTable params={form.queryParams} onChange={(p) => update({ queryParams: p })} />
              </div>
              <div>
                <p className="text-[10px] font-medium text-text-2 mb-2">Header Parameters</p>
                <ParameterTable params={form.headerParams} onChange={(p) => update({ headerParams: p })} />
              </div>
            </>
          )}

          {tab === 'body' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-[10px] text-text-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.hasRequestBody}
                  onChange={(e) => update({ hasRequestBody: e.target.checked })}
                  className="w-3 h-3 accent-[var(--color-accent)]"
                />
                This endpoint has a request body
              </label>
              {form.hasRequestBody && (
                <>
                  <div>
                    <label className="text-[10px] font-medium text-text-2 block mb-1">Content Type</label>
                    <select
                      value={form.requestBodyContentType}
                      onChange={(e) => update({ requestBodyContentType: e.target.value })}
                      className="h-7 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
                    >
                      <option value="application/json">application/json</option>
                      <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                      <option value="multipart/form-data">multipart/form-data</option>
                      <option value="text/plain">text/plain</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-text-2 block mb-1">Schema (JSON Schema or $ref)</label>
                    <textarea
                      value={form.requestBodySchema}
                      onChange={(e) => update({ requestBodySchema: e.target.value })}
                      placeholder={'{"type":"object","properties":{"name":{"type":"string"}}}'}
                      rows={6}
                      className="w-full px-2 py-1.5 text-[10px] font-mono bg-surface-1 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none resize-y"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'responses' && (
            <div className="space-y-3">
              {form.responses.map((resp, i) => (
                <div key={i} className="border border-border-1 rounded p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={resp.statusCode}
                      onChange={(e) => updateResponse(i, { statusCode: e.target.value })}
                      placeholder="200"
                      className="h-6 px-2 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none w-[60px]"
                    />
                    <input
                      value={resp.description}
                      onChange={(e) => updateResponse(i, { description: e.target.value })}
                      placeholder="Description"
                      className="flex-1 h-6 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
                    />
                    <button onClick={() => removeResponse(i)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-surface-3 text-text-4 hover:text-red-400 transition-colors">
                      <span className="text-[11px]">×</span>
                    </button>
                  </div>
                  <textarea
                    value={resp.schema}
                    onChange={(e) => updateResponse(i, { schema: e.target.value })}
                    placeholder={'{"type":"object"} or {"$ref":"#/components/schemas/User"}'}
                    rows={3}
                    className="w-full px-2 py-1 text-[9px] font-mono bg-surface-1 border border-border-1 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none resize-y"
                  />
                </div>
              ))}
              <button
                onClick={addResponse}
                className="flex items-center gap-1.5 h-6 px-2 text-[9px] text-text-3 hover:text-text-1 hover:bg-surface-2 rounded transition-colors"
              >
                <span className="text-[14px] leading-none">+</span>
                Add response
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }
  ```

  **DoD:**
  - [ ] File created at `frontend/src/components/apis/EndpointFormEditor.tsx`
  - [ ] Method + path bar with method selector
  - [ ] Parameters tab: path/query/header tables
  - [ ] Body tab: toggle + content type + schema textarea
  - [ ] Responses tab: status code + description + schema rows
  - [ ] Save button calls `onSave(form)`
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/components/apis/EndpointFormEditor.tsx
  git commit -m "feat: api-editor — add EndpointFormEditor with method/path/params/body/responses tabs"
  ```

---

### Task 4: Create `ApiEditorPanel.tsx`

**Files:**
- Create: `frontend/src/components/apis/ApiEditorPanel.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
  import { useState } from 'react'
  import { Plus } from 'lucide-react'
  import { useCollectionsStore } from '@/stores/collections'
  import { collectionToOAS31 } from '@/lib/oasExport'
  import { EndpointFormEditor, type EndpointDef, type ResponseDef } from './EndpointFormEditor'
  import type { OASParam } from './ParameterTable'
  import { cn } from '@/lib/utils'
  import * as yaml from 'js-yaml'

  const METHOD_COLORS: Record<string, string> = {
    GET: 'bg-blue-900/30 text-blue-300',
    POST: 'bg-green-900/30 text-green-300',
    PUT: 'bg-yellow-900/30 text-yellow-300',
    PATCH: 'bg-orange-900/30 text-orange-300',
    DELETE: 'bg-red-900/30 text-red-300',
  }

  const pathParamRe = /\{(\w+)\}/g

  function specToEndpointList(spec: string): Array<{ method: string; path: string; summary: string }> {
    try {
      const parsed = yaml.load(spec) as { paths?: Record<string, Record<string, { summary?: string }>> }
      const result: Array<{ method: string; path: string; summary: string }> = []
      for (const [path, methods] of Object.entries(parsed?.paths ?? {})) {
        for (const [method, op] of Object.entries(methods)) {
          result.push({ method: method.toUpperCase(), path, summary: op?.summary ?? '' })
        }
      }
      return result
    } catch {
      return []
    }
  }

  function specToEndpointDef(spec: string, method: string, path: string): EndpointDef {
    const blank: EndpointDef = {
      method, path, summary: '', description: '',
      pathParams: [], queryParams: [], headerParams: [],
      hasRequestBody: false, requestBodyContentType: 'application/json', requestBodySchema: '',
      responses: [{ statusCode: '200', description: 'OK', schema: '' }],
    }
    try {
      const parsed = yaml.load(spec) as Record<string, unknown>
      const paths = parsed?.paths as Record<string, Record<string, unknown>> ?? {}
      const op = paths?.[path]?.[method.toLowerCase()] as Record<string, unknown> ?? {}

      blank.summary = (op.summary as string) ?? ''
      blank.description = (op.description as string) ?? ''

      const params = (op.parameters as Array<Record<string, unknown>>) ?? []
      blank.pathParams = params.filter((p) => p.in === 'path').map((p) => ({
        name: p.name as string, in: 'path', required: true,
        type: (p.schema as { type?: string })?.type ?? 'string', description: (p.description as string) ?? '',
      }))
      blank.queryParams = params.filter((p) => p.in === 'query').map((p) => ({
        name: p.name as string, in: 'query', required: (p.required as boolean) ?? false,
        type: (p.schema as { type?: string })?.type ?? 'string', description: (p.description as string) ?? '',
      }))
      blank.headerParams = params.filter((p) => p.in === 'header').map((p) => ({
        name: p.name as string, in: 'header', required: (p.required as boolean) ?? false,
        type: 'string', description: (p.description as string) ?? '',
      }))

      const rb = op.requestBody as Record<string, unknown>
      if (rb) {
        blank.hasRequestBody = true
        const content = rb.content as Record<string, { schema?: unknown }> ?? {}
        const ct = Object.keys(content)[0] ?? 'application/json'
        blank.requestBodyContentType = ct
        blank.requestBodySchema = JSON.stringify(content[ct]?.schema ?? {}, null, 2)
      }

      const responses = op.responses as Record<string, { description?: string; content?: Record<string, { schema?: unknown }> }> ?? {}
      blank.responses = Object.entries(responses).map(([code, r]) => ({
        statusCode: code,
        description: r.description ?? '',
        schema: r.content ? JSON.stringify(Object.values(r.content)[0]?.schema ?? {}, null, 2) : '',
      }))
    } catch { /* use blank */ }
    return blank
  }

  export function ApiEditorPanel() {
    const collections = useCollectionsStore((s) => s.collections)
    const updateCollection = useCollectionsStore((s) => s.updateCollection)

    const [selectedCollectionId, setSelectedCollectionId] = useState('')
    const [selectedEndpoint, setSelectedEndpoint] = useState<{ method: string; path: string } | null>(null)

    const collection = collections.find((c) => c.id === selectedCollectionId)
    const endpoints = collection?._openapiSpec ? specToEndpointList(collection._openapiSpec) : []

    const endpointDef = selectedEndpoint && collection?._openapiSpec
      ? specToEndpointDef(collection._openapiSpec, selectedEndpoint.method, selectedEndpoint.path)
      : null

    const handleSave = (updated: EndpointDef) => {
      if (!collection) return
      // Regenerate the spec from the collection, then merge the updated endpoint
      // For simplicity: regenerate entire spec from collection items + apply form changes
      const newSpec = collectionToOAS31(collection, 'yaml')
      // TODO: merge updated endpoint into newSpec (advanced — use basic OAS update)
      updateCollection(collection.id, { _openapiSpec: newSpec })
    }

    const handleNewEndpoint = () => {
      if (!collection) return
      const newPath = '/new-endpoint'
      const newSpec = collection._openapiSpec
        ? collection._openapiSpec + `\n  ${newPath}:\n    get:\n      summary: New endpoint\n      responses:\n        '200':\n          description: OK\n`
        : `openapi: '3.1.0'\ninfo:\n  title: ${collection.name}\n  version: '1.0.0'\npaths:\n  ${newPath}:\n    get:\n      summary: New endpoint\n      responses:\n        '200':\n          description: OK\n`
      updateCollection(collection.id, { _openapiSpec: newSpec })
      setSelectedEndpoint({ method: 'GET', path: newPath })
    }

    return (
      <div className="flex h-full overflow-hidden">
        {/* Left: collection + endpoint list */}
        <div className="w-[220px] border-r border-border-1 flex flex-col bg-surface-0">
          <div className="p-2 border-b border-border-1">
            <select
              value={selectedCollectionId}
              onChange={(e) => { setSelectedCollectionId(e.target.value); setSelectedEndpoint(null) }}
              className="w-full h-7 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
            >
              <option value="">— Select collection —</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {endpoints.map((ep) => (
              <button
                key={`${ep.method}:${ep.path}`}
                onClick={() => setSelectedEndpoint({ method: ep.method, path: ep.path })}
                className={cn(
                  'w-full text-left flex items-center gap-2 px-3 py-2 transition-colors',
                  selectedEndpoint?.method === ep.method && selectedEndpoint?.path === ep.path
                    ? 'bg-accent/10' : 'hover:bg-surface-1'
                )}
              >
                <span className={cn('text-[8px] font-mono font-bold px-1 py-0.5 rounded shrink-0', METHOD_COLORS[ep.method] ?? 'bg-surface-2 text-text-4')}>
                  {ep.method.slice(0, 3)}
                </span>
                <span className="text-[10px] font-mono text-text-1 truncate">{ep.path}</span>
              </button>
            ))}
            {endpoints.length === 0 && selectedCollectionId && (
              <p className="px-3 py-3 text-[10px] text-text-4 text-center">No spec found.<br />Add an endpoint below.</p>
            )}
          </div>

          {selectedCollectionId && (
            <div className="p-2 border-t border-border-1">
              <button
                onClick={handleNewEndpoint}
                className="w-full h-7 flex items-center justify-center gap-1.5 text-[10px] bg-surface-2 text-text-3 rounded hover:bg-surface-3 hover:text-text-1 transition-colors"
              >
                <Plus size={12} />
                New Endpoint
              </button>
            </div>
          )}
        </div>

        {/* Right: form editor */}
        {endpointDef ? (
          <EndpointFormEditor endpoint={endpointDef} onSave={handleSave} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[10px] text-text-4">
            {selectedCollectionId ? 'Select an endpoint to edit it.' : 'Select a collection to start editing.'}
          </div>
        )}
      </div>
    )
  }
  ```

  **DoD:**
  - [ ] File created at `frontend/src/components/apis/ApiEditorPanel.tsx`
  - [ ] Collection picker populates endpoint list from `_openapiSpec`
  - [ ] Selecting an endpoint loads it in `EndpointFormEditor`
  - [ ] "New Endpoint" adds a blank endpoint to the spec
  - [ ] Save updates `_openapiSpec` on the collection
  - [ ] Build passes

- [ ] **Step 2: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/components/apis/ApiEditorPanel.tsx
  git commit -m "feat: api-editor — add ApiEditorPanel with endpoint list and form-based spec editing"
  ```

  **DoD:**
  - [ ] Build exits 0
  - [ ] Commit created

---

### Task 5: Add API Editor nav item to `WorkspacePanel.tsx`

**Files:**
- Modify: `frontend/src/components/workspace/WorkspacePanel.tsx`

- [ ] **Step 1: Import and wire**

  ```tsx
  import { ApiEditorPanel } from '../apis/ApiEditorPanel'
  // ...
  // Nav item:
  <button onClick={() => setSection('apieditor')} ...>
    <Code2 size={13} />
    API Editor
  </button>

  // Content:
  {section === 'apieditor' && <ApiEditorPanel />}
  ```

  Add `Code2` to lucide-react import.

  **DoD:**
  - [ ] "API Editor" nav item visible in WorkspacePanel
  - [ ] `ApiEditorPanel` renders when selected
  - [ ] Build passes

- [ ] **Step 2: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/components/workspace/WorkspacePanel.tsx
  git commit -m "feat: workspace — add API Editor nav item linking to ApiEditorPanel"
  ```

  **DoD:**
  - [ ] Build exits 0
  - [ ] Commit created

---

### Task 6: Smoke test

- [ ] **Step 1: Manual smoke test**

  Run `wails dev`. Go to Workspace → API Editor. Verify:

  **DoD:**
  - [ ] Select a collection that has a `_openapiSpec` → endpoints list populates
  - [ ] Click an endpoint → form shows method, path, parameters, body, responses
  - [ ] Edit a summary and click Save → no crash; `_openapiSpec` updated on collection
  - [ ] "New Endpoint" adds `/new-endpoint` to the list
  - [ ] Export via Workspace → Export OAS (P12) → YAML includes edited endpoint
