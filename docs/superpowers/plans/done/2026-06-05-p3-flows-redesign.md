# P3 — Flows Full Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Transform Flows into a real API testing flow tool: resizable 40/60 split (Mermaid editor left, live graph right), slide-in node inspector drawer, per-node run-state indicators, collapsible run log, and Shift+click to run from a specific node.

**Architecture:** `FlowsPanel.tsx` owns the split layout and all state. `FlowInspectorDrawer.tsx` is a new side drawer that receives the selected node and its runtime data as props. `FlowRunLog.tsx` is a new collapsible bottom log panel. `FlowGraphView.tsx` gains a run-state visual indicator (spinner/checkmark/error) on each node card. `flowRunner.ts` already has `onRuntime` and `onEntry` callbacks — we hook into those for live updates.

**Tech Stack:** TypeScript, React, Zustand (`useCollectionsStore`, `useEnvironmentsStore`), CSS custom properties. No new dependencies. The resizable split is implemented with `onMouseDown` + `document.addEventListener('mousemove')` — no library needed.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/components/flows/FlowsPanel.tsx` | Full layout rebuild: resizable split, drawer integration, run log integration |
| `frontend/src/components/flows/FlowGraphView.tsx` | Add run-state spinner/icon overlay on FlowNodeCard; add `onShiftClick` prop |
| `frontend/src/components/flows/FlowInspectorDrawer.tsx` | **New** — slide-in drawer with Request/Response/Conditions tabs |
| `frontend/src/components/flows/FlowRunLog.tsx` | **New** — collapsible bottom run log panel |
| `frontend/src/lib/flowRunner.ts` | No changes needed — `onRuntime`/`onEntry` callbacks already exist |

---

## Feature Checklist

- [x] **Resizable 40/60 split (editor left, graph right)**
  - **AC:** Divider is draggable; editor min 200px, graph min 300px; split percentage persists during session
- [x] **Node inspector drawer**
  - **AC:** Clicking a node opens a 300px drawer on the right; graph stays visible; drawer has Request/Response/Conditions tabs
- [x] **Run-state indicators on node cards**
  - **AC:** Spinner during run, green checkmark on success, red X on failure — visible on each node card
- [x] **Collapsible run log**
  - **AC:** After a run, bottom panel shows per-node status/HTTP code/duration; can be collapsed and cleared
- [x] **Shift+click partial run**
  - **AC:** Shift-clicking a node runs the flow starting from that node only

---

### Task 1: Add run-state indicators to FlowNodeCard

**Files:**
- Modify: `frontend/src/components/flows/FlowGraphView.tsx`

- [x] **Step 1: Add `Loader2` to lucide-react imports**

  Find the existing import:
  ```ts
  import { CheckCircle2, ChevronRight, GitFork, Square, XCircle } from 'lucide-react'
  ```
  Add `Loader2`:
  ```ts
  import { CheckCircle2, ChevronRight, GitFork, Loader2, Square, XCircle } from 'lucide-react'
  ```

  **DoD:**
  - [x] `Loader2` imported without error
  - [x] Build passes

- [x] **Step 2: Add `onShiftClick` prop to `FlowNodeCard`**

  Find the `FlowNodeCard` props interface:
  ```ts
  export function FlowNodeCard({ node, runtime, selected, match, onSelect }: {
    node: FlowNodeDefinition
    runtime?: RuntimeByNode[string]
    selected: boolean
    match: ApiCatalogRequest | null
    onSelect: () => void
  })
  ```
  Add `onShiftClick`:
  ```ts
  export function FlowNodeCard({ node, runtime, selected, match, onSelect, onShiftClick }: {
    node: FlowNodeDefinition
    runtime?: RuntimeByNode[string]
    selected: boolean
    match: ApiCatalogRequest | null
    onSelect: () => void
    onShiftClick?: () => void
  })
  ```

  **DoD:**
  - [x] `onShiftClick?: () => void` is optional in the props interface (not required)
  - [x] Existing callers without `onShiftClick` still compile without error
  - [x] Build passes

- [x] **Step 3: Update the button onClick to handle shift-click**

  Find the `<button onClick={onSelect} ...>` inside `FlowNodeCard`. Replace with:

  ```tsx
  <button
    onClick={(e) => {
      if (e.shiftKey && onShiftClick) {
        onShiftClick()
      } else {
        onSelect()
      }
    }}
    className={cn(...)}
  >
  ```

  **DoD:**
  - [x] Shift+clicking a node calls `onShiftClick()` instead of `onSelect()`
  - [x] Regular click still calls `onSelect()`
  - [x] Build passes

- [x] **Step 4: Add run-state icon overlay inside FlowNodeCard**

  Inside `FlowNodeCard`, at the bottom of the button content (after the existing body), add a small status icon:

  ```tsx
  {/* Run-state indicator */}
  {status === 'running' && (
    <div className="absolute top-1.5 right-1.5">
      <Loader2 size={11} className="animate-spin text-accent" />
    </div>
  )}
  {status === 'success' && (
    <div className="absolute top-1.5 right-1.5">
      <CheckCircle2 size={11} className="text-success" />
    </div>
  )}
  {status === 'failed' && (
    <div className="absolute top-1.5 right-1.5">
      <XCircle size={11} className="text-error" />
    </div>
  )}
  ```

  For this to work, the `<button>` must have `relative` positioning. Add `relative` to the button's `className`:
  ```ts
  className={cn(
    'relative w-[232px] rounded-md border p-3 text-left shadow-sm transition-colors',
    ...
  )}
  ```

  **DoD:**
  - [x] `Loader2` spinner renders when `status === 'running'`
  - [x] `CheckCircle2` renders in green when `status === 'success'`
  - [x] `XCircle` renders in red when `status === 'failed'`
  - [x] Button has `relative` positioning so icons are absolutely positioned correctly
  - [x] Build passes

- [x] **Step 5: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors in output

- [x] **Step 6: Commit**

  ```bash
  git add frontend/src/components/flows/FlowGraphView.tsx
  git commit -m "feat: flows — run-state indicators on node cards, shift-click prop"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the expected commit message
  - [x] Only `FlowGraphView.tsx` in the diff

---

### Task 2: Create FlowRunLog component

**Files:**
- Create: `frontend/src/components/flows/FlowRunLog.tsx`

- [x] **Step 1: Create the file**

  ```tsx
  import { ChevronDown, ChevronUp } from 'lucide-react'
  import { useState } from 'react'
  import type { RunEntry } from '@/lib/flowRunner'
  import { cn } from '@/lib/utils'

  interface FlowRunLogProps {
    entries: RunEntry[]
    onClear: () => void
  }

  export function FlowRunLog({ entries, onClear }: FlowRunLogProps) {
    const [collapsed, setCollapsed] = useState(false)

    if (entries.length === 0) return null

    return (
      <div
        className={cn(
          'border-t border-border-1 bg-surface-0 flex-shrink-0 transition-all',
          collapsed ? 'h-8' : 'h-[140px]',
        )}
      >
        {/* Log toolbar */}
        <div className="flex items-center gap-2 px-3 h-8 border-b border-border-1 bg-surface-1">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-text-3 hover:text-text-1 transition-colors"
          >
            {collapsed ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            Run Log
          </button>
          <span className="text-[10px] text-text-4">({entries.length} steps)</span>
          <div className="flex-1" />
          <button
            onClick={onClear}
            className="text-[10px] text-text-4 hover:text-text-1 transition-colors"
          >
            Clear
          </button>
        </div>

        {/* Log entries */}
        {!collapsed && (
          <div className="overflow-y-auto h-[calc(100%-2rem)] font-mono text-[10px]">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-1 border-b border-border-1/30',
                  entry.status === 'failed' ? 'bg-error/5' : '',
                )}
              >
                <span className={cn(
                  'w-14 shrink-0 font-semibold',
                  entry.status === 'success' ? 'text-success' : '',
                  entry.status === 'failed' ? 'text-error' : '',
                  entry.status === 'running' ? 'text-accent' : '',
                  entry.status === 'skipped' ? 'text-warning' : '',
                  entry.status === 'pending' ? 'text-text-4' : '',
                )}>
                  {entry.status}
                </span>
                <span className="text-text-3 shrink-0 w-32 truncate">{entry.nodeLabel}</span>
                {entry.httpStatus !== undefined && (
                  <span className={cn(
                    'shrink-0',
                    entry.httpStatus >= 200 && entry.httpStatus < 300 ? 'text-success' : 'text-error',
                  )}>
                    HTTP {entry.httpStatus}
                  </span>
                )}
                <span className="text-text-4 shrink-0">{entry.durationMs}ms</span>
                {entry.error && (
                  <span className="text-error truncate">{entry.error}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  ```

  **DoD:**
  - [x] File created at `frontend/src/components/flows/FlowRunLog.tsx`
  - [x] Renders nothing (`null`) when `entries.length === 0`
  - [x] Shows collapsed 8px bar when `collapsed === true`
  - [x] Shows 140px log panel when `collapsed === false`
  - [x] Each entry shows: status (colored), nodeLabel, httpStatus (if present), durationMs, error (if present)
  - [x] "Clear" button calls `onClear`
  - [x] Build passes

- [x] **Step 2: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors in output

- [x] **Step 3: Commit**

  ```bash
  git add frontend/src/components/flows/FlowRunLog.tsx
  git commit -m "feat: flows — add FlowRunLog collapsible bottom panel"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the expected commit message
  - [x] Only `FlowRunLog.tsx` in the diff

---

### Task 3: Create FlowInspectorDrawer component

**Files:**
- Create: `frontend/src/components/flows/FlowInspectorDrawer.tsx`

- [x] **Step 1: Create the file**

  ```tsx
  import { X } from 'lucide-react'
  import { useState } from 'react'
  import type { RunEntry, RuntimeByNode } from '@/lib/flowRunner'
  import type { FlowNodeDefinition } from '@/lib/flowStorage'
  import type { RequestItem } from '@/lib/types'
  import { KVEditor } from '@/components/composer/KVEditor'
  import { cn } from '@/lib/utils'

  type DrawerTab = 'request' | 'response' | 'conditions'

  interface FlowInspectorDrawerProps {
    node: FlowNodeDefinition
    runtime?: RuntimeByNode[string]
    lastEntry?: RunEntry
    onClose: () => void
    onUpdateRequest: (nodeId: string, request: RequestItem) => void
    onUpdateCondition: (nodeId: string, edgeId: string, expression: string) => void
    edges: Array<{ id: string; label: string; branch: string; condition?: string }>
  }

  const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

  export function FlowInspectorDrawer({
    node,
    runtime,
    lastEntry,
    onClose,
    onUpdateRequest,
    onUpdateCondition,
    edges,
  }: FlowInspectorDrawerProps) {
    const [tab, setTab] = useState<DrawerTab>('request')
    const request = node.config.request

    function handleMethodChange(method: string) {
      if (!request) return
      onUpdateRequest(node.id, { ...request, method })
    }

    function handleUrlChange(url: string) {
      if (!request) return
      onUpdateRequest(node.id, { ...request, url })
    }

    return (
      <div className="w-[300px] flex-shrink-0 border-l border-border-1 bg-surface-0 flex flex-col overflow-hidden">
        {/* Drawer header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-1 bg-surface-1 flex-shrink-0">
          <span className="text-[11px] font-semibold text-text-1 flex-1 truncate">{node.label}</span>
          <span className="text-[9px] text-text-4 bg-surface-2 px-1.5 py-0.5 rounded">{node.type}</span>
          <button onClick={onClose} className="p-0.5 rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors">
            <X size={13} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border-1 bg-surface-1 flex-shrink-0">
          {(['request', 'response', 'conditions'] as DrawerTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 py-1.5 text-[10px] capitalize transition-colors',
                tab === t ? 'text-accent border-b-2 border-accent bg-surface-0' : 'text-text-4 hover:text-text-2',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'request' && (
            <div className="flex flex-col gap-3">
              {node.type !== 'request' ? (
                <p className="text-[10px] text-text-4">This node type has no request configuration.</p>
              ) : !request ? (
                <p className="text-[10px] text-text-4">No request configured. The node will use a request from your collections when matched by label.</p>
              ) : (
                <>
                  {/* Method + URL */}
                  <div className="flex gap-1.5">
                    <select
                      value={request.method || 'GET'}
                      onChange={(e) => handleMethodChange(e.target.value)}
                      className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 focus:border-accent outline-none shrink-0"
                    >
                      {HTTP_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      value={request.url || ''}
                      onChange={(e) => handleUrlChange(e.target.value)}
                      placeholder="https://api.example.com/path"
                      className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 focus:border-accent outline-none font-mono"
                    />
                  </div>

                  {/* Headers */}
                  <div>
                    <div className="text-[9px] text-text-4 uppercase tracking-wide mb-1.5">Headers</div>
                    <KVEditor
                      pairs={request.headers ?? []}
                      onChange={(headers) => onUpdateRequest(node.id, { ...request, headers })}
                      keyPlaceholder="Header"
                      valuePlaceholder="Value"
                    />
                  </div>

                  {/* Body (simple textarea for now) */}
                  {['POST', 'PUT', 'PATCH'].includes(request.method || '') && (
                    <div>
                      <div className="text-[9px] text-text-4 uppercase tracking-wide mb-1.5">Body</div>
                      <textarea
                        value={request.body?.content ?? ''}
                        onChange={(e) => onUpdateRequest(node.id, {
                          ...request,
                          body: { ...request.body, content: e.target.value, mode: request.body?.mode ?? 'raw' },
                        })}
                        rows={6}
                        className="w-full bg-surface-2 border border-border-2 rounded text-[10px] font-mono text-text-1 p-2 focus:border-accent outline-none resize-y"
                        placeholder='{"key": "value"}'
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'response' && (
            <div className="flex flex-col gap-2">
              {!lastEntry ? (
                <p className="text-[10px] text-text-4">No run data yet. Run the flow to see the response.</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-[10px] font-semibold px-2 py-0.5 rounded',
                      lastEntry.status === 'success' ? 'bg-success/15 text-success' : 'bg-error/15 text-error',
                    )}>
                      {lastEntry.status}
                    </span>
                    {lastEntry.httpStatus !== undefined && (
                      <span className="text-[10px] text-text-3">HTTP {lastEntry.httpStatus}</span>
                    )}
                    <span className="text-[10px] text-text-4">{lastEntry.durationMs}ms</span>
                  </div>
                  {lastEntry.response?.body && (
                    <div>
                      <div className="text-[9px] text-text-4 uppercase tracking-wide mb-1.5">Body</div>
                      <pre className="text-[9px] font-mono text-text-2 bg-surface-2 border border-border-2 rounded p-2 overflow-auto max-h-[200px] whitespace-pre-wrap break-all">
                        {lastEntry.response.body}
                      </pre>
                    </div>
                  )}
                  {lastEntry.error && (
                    <div className="text-[10px] text-error bg-error/10 rounded p-2">{lastEntry.error}</div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'conditions' && (
            <div className="flex flex-col gap-2">
              {edges.length === 0 ? (
                <p className="text-[10px] text-text-4">No outgoing edges from this node.</p>
              ) : (
                edges.map((edge) => (
                  <div key={edge.id} className="flex flex-col gap-1">
                    <div className="text-[9px] text-text-4 uppercase tracking-wide">
                      Edge: {edge.label || edge.branch || edge.id}
                    </div>
                    <input
                      value={edge.condition ?? ''}
                      onChange={(e) => onUpdateCondition(node.id, edge.id, e.target.value)}
                      placeholder='status == 200 or $.data != null'
                      className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-[10px] font-mono text-text-1 focus:border-accent outline-none w-full"
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    )
  }
  ```

  **DoD:**
  - [x] File created at `frontend/src/components/flows/FlowInspectorDrawer.tsx`
  - [x] Drawer is 300px wide with a visible border on the left
  - [x] Header shows node label, node type badge, and × close button
  - [x] Three tabs render: Request, Response, Conditions
  - [x] Request tab: shows "No request configured" for non-request nodes; shows method/URL/headers/body for request nodes
  - [x] Response tab: shows "No run data yet" before any run; shows status, HTTP code, body after a run
  - [x] Conditions tab: shows "No outgoing edges" for leaf nodes; shows condition inputs for nodes with outgoing edges
  - [x] Build passes

- [x] **Step 2: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors in output

- [x] **Step 3: Commit**

  ```bash
  git add frontend/src/components/flows/FlowInspectorDrawer.tsx
  git commit -m "feat: flows — add FlowInspectorDrawer with Request/Response/Conditions tabs"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the expected commit message
  - [x] Only `FlowInspectorDrawer.tsx` in the diff

---

### Task 4: Rebuild FlowsPanel layout with resizable split and integrated drawer/log

**Files:**
- Modify: `frontend/src/components/flows/FlowsPanel.tsx`

This is the largest task. The panel currently has a fixed layout. We replace it with a resizable split and wire in the drawer and run log.

- [x] **Step 1: Add `useRef` and mouse-drag state for resizable split**

  At the top of the `FlowsPanel` component body, add:

  ```ts
  const [splitPct, setSplitPct] = useState(40) // editor takes 40%
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null)
  const [runFromNodeId, setRunFromNodeId] = useState<string | null>(null)
  ```

  **DoD:**
  - [x] `splitPct` defaults to 40
  - [x] `inspectorNodeId` defaults to `null`
  - [x] `containerRef` attached to the outer container div
  - [x] Build passes

- [x] **Step 2: Add mouse event handlers for the divider**

  After the state declarations, add:

  ```ts
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const container = containerRef.current
    if (!container) return
    const startX = e.clientX
    const startPct = splitPct
    const totalWidth = container.getBoundingClientRect().width

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      const newPct = Math.min(70, Math.max(20, startPct + (delta / totalWidth) * 100))
      setSplitPct(newPct)
    }
    const onMouseUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [splitPct])
  ```

  **DoD:**
  - [x] `handleDividerMouseDown` sets `dragging` to true on mousedown
  - [x] Dragging left/right changes `splitPct` within [20, 70] range
  - [x] Mouse event listeners removed on mouseup (no memory leaks)
  - [x] Build passes

- [x] **Step 3: Replace the panel's main content area with the new split layout**

  Find the JSX that renders the Mermaid editor and graph side by side. Replace the outer container with:

  ```tsx
  {/* Main area: resizable split */}
  <div
    ref={containerRef}
    className="flex flex-1 overflow-hidden"
    style={{ cursor: dragging ? 'col-resize' : undefined }}
  >
    {/* Left: Mermaid editor */}
    <div
      className="flex flex-col overflow-hidden border-r border-border-1"
      style={{ width: `${splitPct}%`, minWidth: 200 }}
    >
      {/* existing Mermaid editor textarea content goes here, unchanged */}
    </div>

    {/* Divider */}
    <div
      onMouseDown={handleDividerMouseDown}
      className="w-1 flex-shrink-0 bg-border-1 hover:bg-accent/50 cursor-col-resize transition-colors"
    />

    {/* Right: Graph + optional inspector drawer */}
    <div className="flex flex-1 overflow-hidden" style={{ minWidth: 300 }}>
      {/* Graph */}
      <div className="flex-1 overflow-auto p-4">
        {/* existing graph rendering */}
      </div>

      {/* Inspector drawer (slide in when a node is selected) */}
      {inspectorNodeId && selectedNode && (
        <FlowInspectorDrawer
          node={selectedNode}
          runtime={runtime[inspectorNodeId]}
          lastEntry={runEntries.find((e) => e.nodeId === inspectorNodeId)}
          onClose={() => setInspectorNodeId(null)}
          onUpdateRequest={(nodeId, request) => {
            // update the node's config in the current graph definition
            setCurrentGraph((g) => ({
              ...g,
              nodes: g.nodes.map((n) =>
                n.id === nodeId ? { ...n, config: { ...n.config, request } } : n,
              ),
            }))
          }}
          onUpdateCondition={(nodeId, edgeId, expression) => {
            setCurrentGraph((g) => ({
              ...g,
              edges: g.edges.map((edge) =>
                edge.id === edgeId ? { ...edge, condition: expression } : edge,
              ),
            }))
          }}
          edges={currentGraph.edges
            .filter((e) => e.source === inspectorNodeId)
            .map((e) => ({ id: e.id, label: e.label ?? '', branch: e.branch, condition: e.condition }))}
        />
      )}
    </div>
  </div>

  {/* Run log at bottom */}
  <FlowRunLog
    entries={runEntries}
    onClear={() => setRunEntries([])}
  />
  ```

  Note: `selectedNode`, `currentGraph`, `setCurrentGraph`, `runtime`, and `runEntries` are the existing state variables in `FlowsPanel`. Adapt the variable names to match whatever the panel currently uses. Key principle: when a node is clicked, call `setInspectorNodeId(node.id)`. When Shift+click, set `runFromNodeId(node.id)` and trigger a partial run.

  **DoD:**
  - [x] Mermaid editor is on the left at `splitPct`% width with `minWidth: 200`
  - [x] Graph is on the right with `flex-1` and `minWidth: 300`
  - [x] Divider between them has `cursor-col-resize` and hover highlight
  - [x] `FlowInspectorDrawer` renders when `inspectorNodeId` is set and `selectedNode` exists
  - [x] `FlowRunLog` renders at the bottom (it returns null when empty)
  - [x] Build passes

- [x] **Step 4: Wire `onShiftClick` on FlowNodeCard calls**

  Find where `FlowNodeCard` is rendered (inside the graph area). Add the `onShiftClick` prop:

  ```tsx
  <FlowNodeCard
    node={node}
    runtime={runtime[node.id]}
    selected={inspectorNodeId === node.id}
    match={matchCatalogRequest(node, catalogRequests)}
    onSelect={() => setInspectorNodeId(node.id)}
    onShiftClick={() => setRunFromNodeId(node.id)}
  />
  ```

  **DoD:**
  - [x] `FlowNodeCard` receives `onShiftClick` prop that sets `runFromNodeId`
  - [x] `onSelect` sets `inspectorNodeId`
  - [x] Build passes

- [x] **Step 5: Wire `runFromNodeId` into the run logic**

  Find the existing run handler (the function called by the Play button). Add handling for partial run:

  ```ts
  const handleRun = useCallback(async (fromNodeId?: string) => {
    // existing run logic already calls runApiFlow(...)
    // just pass the startNodeId if provided:
    await runApiFlow(graph, {
      // ... existing options ...
      startNodeId: fromNodeId,   // add this if runApiFlow supports it
      onRuntime: (rt) => setRuntime(rt),
      onEntry: (entries) => setRunEntries(entries),
    })
  }, [/* deps */])

  // When runFromNodeId changes, trigger run from that node
  useEffect(() => {
    if (runFromNodeId) {
      handleRun(runFromNodeId)
      setRunFromNodeId(null)
    }
  }, [runFromNodeId, handleRun])
  ```

  Check `flowRunner.ts` — if `runApiFlow` does not yet accept a `startNodeId`, add it:

  In `frontend/src/lib/flowRunner.ts`, in `RunApiFlowOptions`, add:
  ```ts
  startNodeId?: string
  ```
  In the `runApiFlow` function, use `startNodeId` to find the starting node instead of always using the first node with no incoming edges.

  **DoD:**
  - [x] `handleRun(fromNodeId?)` passes `startNodeId` to `runApiFlow` when provided
  - [x] `useEffect` triggers `handleRun(runFromNodeId)` when `runFromNodeId` changes, then resets to `null`
  - [x] If `runApiFlow` does not accept `startNodeId`, it is added to `RunApiFlowOptions` in `flowRunner.ts`
  - [x] Build passes

- [x] **Step 6: Add imports at top of FlowsPanel.tsx**

  Add the new component imports:
  ```ts
  import { FlowInspectorDrawer } from '@/components/flows/FlowInspectorDrawer'
  import { FlowRunLog } from '@/components/flows/FlowRunLog'
  ```

  **DoD:**
  - [x] `FlowInspectorDrawer` and `FlowRunLog` imports resolve without error
  - [x] Build passes

- [x] **Step 7: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors in output

- [x] **Step 8: Manual smoke test**

  Run `wails dev`. Go to Flows. Verify:
  - The panel has a Mermaid editor on the left (~40%) and a graph on the right (~60%).
  - Dragging the divider resizes the split. Editor never goes below 200px, graph never below 300px.
  - Clicking a node opens the inspector drawer from the right (300px). The graph stays visible.
  - The drawer shows Request / Response / Conditions tabs.
  - On the Request tab: method selector and URL input are editable. Changing them updates the node.
  - Clicking the × closes the drawer.
  - Pressing the Play button runs the full flow. Nodes show spinner → green/red icons.
  - Run log appears at the bottom, collapsible.
  - Shift+clicking a node runs from that node only.

  **DoD:**
  - [x] Resizable divider works — can drag left/right; editor and graph resize
  - [x] Editor never goes below 200px; graph never goes below 300px
  - [x] Clicking a node opens inspector drawer on the right side; graph stays visible
  - [x] Drawer shows Request/Response/Conditions tabs
  - [x] Method and URL are editable in Request tab; changes are reflected
  - [x] × closes the drawer
  - [x] Play button runs the flow; node cards show spinner → green/red
  - [x] Run log appears at bottom and is collapsible
  - [x] Shift+click on a node runs from that node only

- [x] **Step 9: Commit**

  ```bash
  git add frontend/src/components/flows/FlowsPanel.tsx frontend/src/lib/flowRunner.ts
  git commit -m "feat: flows — resizable split layout, inspector drawer, run log, shift-click partial run"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the expected commit message
  - [x] `FlowsPanel.tsx` and `flowRunner.ts` (if modified) are in the diff
