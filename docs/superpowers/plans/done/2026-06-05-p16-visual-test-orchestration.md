# P16 — Visual Test Orchestration (No-Code Test Builder) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** A drag-and-drop visual builder for multi-step API test scenarios using block-based cards (Request, Assert, SetVar, If, Loop) — lower barrier than raw Mermaid text. Results shown per-block. Tests can be exported to Mermaid format for use with the existing Flow Runner.

**Architecture:** `VisualTestPanel.tsx` renders a vertical card stack. Each `TestBlockCard.tsx` is a self-contained unit showing its type, config form, and run status. `visualTestRunner.ts` walks the block list, executes request blocks via `executeRequest.ts`, evaluates assertions inline, and tracks per-block status. Tests stored in `adomnia.v2` as `visualTests: VisualTest[]`.

**Tech Stack:** TypeScript, React, Zustand. No new dependencies (no graph library — vertical card list is sufficient for v1).

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/lib/types.ts` | Add `VisualTest`, `TestBlock`, `BlockType`, `BlockRunState` types |
| `frontend/src/stores/visualTests.ts` | **New** — `useVisualTestsStore`: list of visual tests, add/update/remove, persistence |
| `frontend/src/lib/visualTestRunner.ts` | **New** — sequential block executor |
| `frontend/src/components/testdata/TestBlockCard.tsx` | **New** — individual block card (type picker, config form, run status) |
| `frontend/src/components/testdata/VisualTestPanel.tsx` | **New** — main builder: test list, block canvas, run button |
| `frontend/src/components/layout/Rail.tsx` | Ensure `testdata` rail item links to `VisualTestPanel` |

---

> **EXECUTION NOTE (2026-06-05):** Adapted to the real codebase:
> - `nanoid` absent → `uid()`; `safeGet`/`safeSet` absent → `localStorage.getItem` + `safeSetItem`.
> - `executeRequest(request, vars)` returns `{ response: ResponseData, ... }`; runner passes real
>   `RequestItem`s from `collection.children`.
> - **Fixed a plan bug:** the plan's runner never propagated a request's response to subsequent
>   Assert blocks (`lastResponse` was always null). The runner now returns the response from a
>   request block and feeds it forward, so asserts work.
> - **New Rail panel** `visualtests` ("Visual Tests", API Core › Testing) wired in `stores/app.ts`,
>   `MainArea.tsx`, `Rail.tsx`. The plan suggested reusing the `testdata` rail item, but that maps
>   to the existing **TestDataStudio** (a faker/data generator) — hijacking it would remove
>   functionality, so a dedicated panel was added instead.
> - Run state icons / block accents use status + `--color-method-*` tokens (not hardcoded palette).
> - SetVar resolves `${var}` references against the running variable map.

## Feature Checklist

- [x] **Block types: Request, Assert, SetVar** *(If/Loop typed but v1 runner skips them)*
  - **AC:** Request block: pick from collection items (method + name); Assert block: source (body/status/header) + field + operator + expected; SetVar: name + expression with `${var}` resolution
- [x] **Visual builder canvas**
  - **AC:** Blocks as vertical cards; "Add block" dropdown; up/down reorder buttons; delete block button
- [x] **Block runner with per-block status**
  - **AC:** "Run Test" executes blocks sequentially; each card shows spinner → PASS/FAIL with message; SetVar/extracted vars flow to later blocks; request responses flow to later asserts
- [x] **Export to Flow** *(implemented as a graph export, not raw Mermaid)*
  - **AC:** "Export to Flow" button in VisualTestPanel converts the test to a `SavedFlowDefinition` (`visualTestToFlow`) and appends it to the flows store via `loadFlowDefinitions`/`saveFlowDefinitions`. Request blocks → `request` nodes (resolved RequestItem + extractions), Assert → `condition` nodes, SetVar → `extract` nodes; chained Start→…→End(success). Flows use a node/edge graph (not raw Mermaid text), and the Flow editor already renders Mermaid from that graph, so exporting to the graph model is the faithful integration. if/loop blocks are omitted from the export (consistent with the v1 runner).
- [x] **Persistence**
  - **AC:** Tests stored in `adomnia.visualTests`; survive reload

---

### Task 1: Add types to `types.ts`

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add block and test types**

  ```ts
  export type BlockType = 'request' | 'assert' | 'setvar' | 'if' | 'loop'

  export type BlockRunState = 'idle' | 'running' | 'passed' | 'failed' | 'skipped'

  export interface RequestBlock {
    type: 'request'
    id: string
    collectionItemId: string
    label: string
    extractVars: { varName: string; jsonPath: string }[]
  }

  export interface AssertBlock {
    type: 'assert'
    id: string
    label: string
    source: 'body' | 'status' | 'header'
    field: string
    operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'exists'
    expected: string
  }

  export interface SetVarBlock {
    type: 'setvar'
    id: string
    varName: string
    expression: string
  }

  export interface IfBlock {
    type: 'if'
    id: string
    condition: string
    thenBlocks: TestBlock[]
    elseBlocks: TestBlock[]
  }

  export interface LoopBlock {
    type: 'loop'
    id: string
    count: number
    blocks: TestBlock[]
  }

  export type TestBlock = RequestBlock | AssertBlock | SetVarBlock | IfBlock | LoopBlock

  export interface VisualTest {
    id: string
    name: string
    blocks: TestBlock[]
    envId: string | null
  }

  export interface BlockResult {
    blockId: string
    state: BlockRunState
    message: string
    durationMs: number
  }

  export interface VisualTestResult {
    testId: string
    blockResults: BlockResult[]
    passed: boolean
    durationMs: number
  }
  ```

  **DoD:**
  - [ ] All types defined and exported
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/lib/types.ts
  git commit -m "feat: types — add VisualTest, TestBlock, BlockType, BlockResult types"
  ```

---

### Task 2: Create `useVisualTestsStore`

**Files:**
- Create: `frontend/src/stores/visualTests.ts`

- [ ] **Step 1: Create the file**

  ```ts
  import { create } from 'zustand'
  import { nanoid } from 'nanoid'
  import { safeGet, safeSet } from '@/lib/safeLocalStorage'
  import type { VisualTest, TestBlock } from '@/lib/types'

  const STORAGE_KEY = 'adomnia.visualTests'

  function load(): VisualTest[] {
    try { return JSON.parse(safeGet(STORAGE_KEY) ?? '[]') } catch { return [] }
  }

  interface VisualTestsState {
    tests: VisualTest[]
    addTest: (name: string) => string
    updateTest: (id: string, patch: Partial<VisualTest>) => void
    removeTest: (id: string) => void
    addBlock: (testId: string, block: TestBlock) => void
    updateBlock: (testId: string, blockId: string, patch: Partial<TestBlock>) => void
    removeBlock: (testId: string, blockId: string) => void
    moveBlock: (testId: string, fromIdx: number, toIdx: number) => void
  }

  export const useVisualTestsStore = create<VisualTestsState>((set, get) => ({
    tests: load(),

    addTest: (name) => {
      const id = nanoid()
      const next = [...get().tests, { id, name, blocks: [], envId: null }]
      set({ tests: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
      return id
    },

    updateTest: (id, patch) => {
      const next = get().tests.map((t) => t.id === id ? { ...t, ...patch } : t)
      set({ tests: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },

    removeTest: (id) => {
      const next = get().tests.filter((t) => t.id !== id)
      set({ tests: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },

    addBlock: (testId, block) => {
      const next = get().tests.map((t) =>
        t.id === testId ? { ...t, blocks: [...t.blocks, block] } : t
      )
      set({ tests: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },

    updateBlock: (testId, blockId, patch) => {
      const next = get().tests.map((t) =>
        t.id === testId
          ? { ...t, blocks: t.blocks.map((b) => b.id === blockId ? { ...b, ...patch } as TestBlock : b) }
          : t
      )
      set({ tests: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },

    removeBlock: (testId, blockId) => {
      const next = get().tests.map((t) =>
        t.id === testId ? { ...t, blocks: t.blocks.filter((b) => b.id !== blockId) } : t
      )
      set({ tests: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },

    moveBlock: (testId, fromIdx, toIdx) => {
      const next = get().tests.map((t) => {
        if (t.id !== testId) return t
        const blocks = [...t.blocks]
        const [moved] = blocks.splice(fromIdx, 1)
        blocks.splice(toIdx, 0, moved)
        return { ...t, blocks }
      })
      set({ tests: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },
  }))
  ```

  **DoD:**
  - [ ] File created at `frontend/src/stores/visualTests.ts`
  - [ ] All CRUD actions present
  - [ ] Persisted to `adomnia.visualTests`
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/stores/visualTests.ts
  git commit -m "feat: add useVisualTestsStore — visual test CRUD with localStorage persistence"
  ```

---

### Task 3: Create `visualTestRunner.ts`

**Files:**
- Create: `frontend/src/lib/visualTestRunner.ts`

- [ ] **Step 1: Create the file**

  ```ts
  import type { VisualTest, TestBlock, BlockResult, VisualTestResult, RequestBlock, AssertBlock, SetVarBlock } from '@/lib/types'
  import { executeRequest } from '@/lib/executeRequest'
  import { useCollectionsStore } from '@/stores/collections'
  import { useEnvironmentsStore } from '@/stores/environments'

  type OnBlockUpdate = (blockId: string, state: BlockResult) => void

  function flattenRequests(children: unknown[]): Array<{ id: string; [key: string]: unknown }> {
    const result: Array<{ id: string; [key: string]: unknown }> = []
    for (const child of children) {
      const c = child as { id: string; type?: string; children?: unknown[] }
      if (c.type === 'request' || !c.children) result.push(c)
      else if (c.children) result.push(...flattenRequests(c.children))
    }
    return result
  }

  function evalCondition(condition: string, vars: Record<string, string>): boolean {
    // Simple variable substitution and eval — condition is a JS expression
    // Using a very restricted approach: only support "varName op value"
    const parts = condition.trim().split(/\s+/)
    if (parts.length >= 3) {
      const lhs = vars[parts[0]] ?? parts[0]
      const op = parts[1]
      const rhs = parts.slice(2).join(' ').replace(/^['"]|['"]$/g, '')
      switch (op) {
        case '==': return lhs === rhs
        case '!=': return lhs !== rhs
        case '>': return parseFloat(lhs) > parseFloat(rhs)
        case '<': return parseFloat(lhs) < parseFloat(rhs)
      }
    }
    return Boolean(vars[condition.trim()])
  }

  function extractJsonPath(body: string, path: string): string {
    try {
      let obj = JSON.parse(body)
      const parts = path.replace(/^\$\.?/, '').split('.')
      for (const part of parts) {
        if (obj === null || typeof obj !== 'object') return ''
        obj = (obj as Record<string, unknown>)[part]
      }
      return String(obj ?? '')
    } catch { return '' }
  }

  async function runBlock(
    block: TestBlock,
    vars: Record<string, string>,
    lastResponse: { body: string; status: number; headers: Record<string, string> } | null,
    onUpdate: OnBlockUpdate,
    allRequests: Array<{ id: string; [key: string]: unknown }>
  ): Promise<{ passed: boolean; message: string }> {
    const start = Date.now()
    onUpdate(block.id, { blockId: block.id, state: 'running', message: '', durationMs: 0 })

    try {
      if (block.type === 'request') {
        const rb = block as RequestBlock
        const reqItem = allRequests.find((r) => r.id === rb.collectionItemId)
        if (!reqItem) return { passed: false, message: `Request item not found: ${rb.collectionItemId}` }

        // Substitute vars into the request
        const envVars = { ...vars }
        const result = await executeRequest(reqItem as never, envVars)

        // Extract variables
        for (const extract of rb.extractVars ?? []) {
          if (extract.varName && extract.jsonPath) {
            vars[extract.varName] = extractJsonPath(result.response?.body ?? '', extract.jsonPath)
          }
        }

        onUpdate(block.id, { blockId: block.id, state: 'passed', message: `${result.response?.status ?? '?'} ${result.response?.statusText ?? ''}`, durationMs: Date.now() - start })
        return { passed: true, message: 'ok' }
      }

      if (block.type === 'assert') {
        const ab = block as AssertBlock
        if (!lastResponse) return { passed: false, message: 'No previous response to assert against' }
        let actual = ''
        if (ab.source === 'status') actual = String(lastResponse.status)
        else if (ab.source === 'header') actual = lastResponse.headers[ab.field.toLowerCase()] ?? ''
        else actual = extractJsonPath(lastResponse.body, ab.field)

        let passed = false
        switch (ab.operator) {
          case 'eq': passed = actual === ab.expected; break
          case 'neq': passed = actual !== ab.expected; break
          case 'contains': passed = actual.includes(ab.expected); break
          case 'gt': passed = parseFloat(actual) > parseFloat(ab.expected); break
          case 'lt': passed = parseFloat(actual) < parseFloat(ab.expected); break
          case 'exists': passed = actual !== ''; break
        }
        const msg = passed ? `${actual} ${ab.operator} ${ab.expected}` : `Expected ${ab.field} ${ab.operator} "${ab.expected}", got "${actual}"`
        onUpdate(block.id, { blockId: block.id, state: passed ? 'passed' : 'failed', message: msg, durationMs: Date.now() - start })
        return { passed, message: msg }
      }

      if (block.type === 'setvar') {
        const sv = block as SetVarBlock
        vars[sv.varName] = sv.expression // In v1, expression is a literal value or ${otherVar}
        onUpdate(block.id, { blockId: block.id, state: 'passed', message: `${sv.varName} = ${vars[sv.varName]}`, durationMs: Date.now() - start })
        return { passed: true, message: 'ok' }
      }

      onUpdate(block.id, { blockId: block.id, state: 'skipped', message: 'block type not yet supported in runner', durationMs: Date.now() - start })
      return { passed: true, message: 'skipped' }
    } catch (e) {
      onUpdate(block.id, { blockId: block.id, state: 'failed', message: String(e), durationMs: Date.now() - start })
      return { passed: false, message: String(e) }
    }
  }

  export async function runVisualTest(
    test: VisualTest,
    onBlockUpdate: OnBlockUpdate
  ): Promise<VisualTestResult> {
    const collections = useCollectionsStore.getState().collections
    const allRequests = collections.flatMap((c) => flattenRequests(c.children ?? []))
    const vars: Record<string, string> = {}
    const blockResults: BlockResult[] = []
    let allPassed = true
    const start = Date.now()
    let lastResponse: { body: string; status: number; headers: Record<string, string> } | null = null

    for (const block of test.blocks) {
      const { passed, message } = await runBlock(block, vars, lastResponse, (id, result) => {
        blockResults.push(result)
        onBlockUpdate(id, result)
      }, allRequests)
      if (!passed) { allPassed = false; break }
    }

    return { testId: test.id, blockResults, passed: allPassed, durationMs: Date.now() - start }
  }
  ```

  **DoD:**
  - [ ] File created at `frontend/src/lib/visualTestRunner.ts`
  - [ ] `runVisualTest(test, onBlockUpdate)` exported
  - [ ] Request blocks execute via `executeRequest`
  - [ ] Assert blocks evaluate against `lastResponse`
  - [ ] SetVar blocks update the shared `vars` map
  - [ ] `onBlockUpdate` called per block with running/passed/failed state
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/lib/visualTestRunner.ts
  git commit -m "feat: add visualTestRunner — sequential block executor with request/assert/setvar support"
  ```

---

### Task 4: Create `TestBlockCard.tsx`

**Files:**
- Create: `frontend/src/components/testdata/TestBlockCard.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
  import { Trash2, ChevronUp, ChevronDown, Play, CheckCircle2, XCircle, Loader2, SkipForward } from 'lucide-react'
  import { useCollectionsStore } from '@/stores/collections'
  import type { TestBlock, BlockResult, RequestBlock, AssertBlock, SetVarBlock } from '@/lib/types'
  import { cn } from '@/lib/utils'

  function flattenRequests(children: unknown[]): Array<{ id: string; name: string; method?: string }> {
    const result: Array<{ id: string; name: string; method?: string }> = []
    for (const child of children) {
      const c = child as { id: string; name?: string; type?: string; method?: string; children?: unknown[] }
      if (c.type === 'request' || !c.children) result.push({ id: c.id, name: c.name ?? '', method: c.method })
      else if (c.children) result.push(...flattenRequests(c.children))
    }
    return result
  }

  interface Props {
    block: TestBlock
    result?: BlockResult
    onUpdate: (patch: Partial<TestBlock>) => void
    onDelete: () => void
    onMoveUp: () => void
    onMoveDown: () => void
    isFirst: boolean
    isLast: boolean
  }

  const STATE_ICONS: Record<string, React.ReactNode> = {
    running: <Loader2 size={12} className="animate-spin text-yellow-400" />,
    passed: <CheckCircle2 size={12} className="text-green-400" />,
    failed: <XCircle size={12} className="text-red-400" />,
    skipped: <SkipForward size={12} className="text-text-4" />,
    idle: null,
  }

  const BLOCK_LABELS: Record<string, string> = {
    request: 'Request',
    assert: 'Assert',
    setvar: 'Set Variable',
    if: 'If',
    loop: 'Loop',
  }

  const BLOCK_COLORS: Record<string, string> = {
    request: 'border-l-blue-500',
    assert: 'border-l-green-500',
    setvar: 'border-l-yellow-500',
    if: 'border-l-purple-500',
    loop: 'border-l-orange-500',
  }

  export function TestBlockCard({ block, result, onUpdate, onDelete, onMoveUp, onMoveDown, isFirst, isLast }: Props) {
    const collections = useCollectionsStore((s) => s.collections)
    const allRequests = collections.flatMap((c) => flattenRequests(c.children ?? []))

    return (
      <div className={cn('border border-border-1 rounded bg-surface-1 border-l-2', BLOCK_COLORS[block.type])}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-1">
          <span className="text-[9px] font-semibold text-text-3 uppercase tracking-wider">
            {BLOCK_LABELS[block.type]}
          </span>
          <div className="flex-1" />
          {STATE_ICONS[result?.state ?? 'idle']}
          {result?.message && (
            <span className={cn('text-[9px] truncate max-w-[160px]', result.state === 'failed' ? 'text-red-400' : 'text-text-4')}>
              {result.message}
            </span>
          )}
          <button onClick={onMoveUp} disabled={isFirst} className="p-0.5 rounded hover:bg-surface-2 text-text-4 disabled:opacity-30">
            <ChevronUp size={11} />
          </button>
          <button onClick={onMoveDown} disabled={isLast} className="p-0.5 rounded hover:bg-surface-2 text-text-4 disabled:opacity-30">
            <ChevronDown size={11} />
          </button>
          <button onClick={onDelete} className="p-0.5 rounded hover:bg-surface-2 text-text-4 hover:text-red-400">
            <Trash2 size={11} />
          </button>
        </div>

        {/* Block form */}
        <div className="px-3 py-2">
          {block.type === 'request' && (() => {
            const rb = block as RequestBlock
            return (
              <div className="flex items-center gap-2">
                <select
                  value={rb.collectionItemId}
                  onChange={(e) => {
                    const req = allRequests.find((r) => r.id === e.target.value)
                    onUpdate({ collectionItemId: e.target.value, label: req?.name ?? '' } as Partial<RequestBlock>)
                  }}
                  className="flex-1 h-6 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
                >
                  <option value="">— Select request —</option>
                  {allRequests.map((r) => (
                    <option key={r.id} value={r.id}>{r.method ?? '?'} {r.name}</option>
                  ))}
                </select>
              </div>
            )
          })()}

          {block.type === 'assert' && (() => {
            const ab = block as AssertBlock
            return (
              <div className="flex items-center gap-1.5 flex-wrap">
                <select
                  value={ab.source}
                  onChange={(e) => onUpdate({ source: e.target.value as AssertBlock['source'] } as Partial<AssertBlock>)}
                  className="h-6 px-1.5 text-[9px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
                >
                  <option value="body">body</option>
                  <option value="status">status</option>
                  <option value="header">header</option>
                </select>
                <input
                  value={ab.field}
                  onChange={(e) => onUpdate({ field: e.target.value } as Partial<AssertBlock>)}
                  placeholder="$.field or status"
                  className="h-6 px-2 text-[9px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none w-[110px]"
                />
                <select
                  value={ab.operator}
                  onChange={(e) => onUpdate({ operator: e.target.value as AssertBlock['operator'] } as Partial<AssertBlock>)}
                  className="h-6 px-1.5 text-[9px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
                >
                  <option value="eq">=</option>
                  <option value="neq">≠</option>
                  <option value="contains">contains</option>
                  <option value="gt">&gt;</option>
                  <option value="lt">&lt;</option>
                  <option value="exists">exists</option>
                </select>
                {ab.operator !== 'exists' && (
                  <input
                    value={ab.expected}
                    onChange={(e) => onUpdate({ expected: e.target.value } as Partial<AssertBlock>)}
                    placeholder="expected"
                    className="h-6 px-2 text-[9px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none flex-1 min-w-[80px]"
                  />
                )}
              </div>
            )
          })()}

          {block.type === 'setvar' && (() => {
            const sv = block as SetVarBlock
            return (
              <div className="flex items-center gap-1.5">
                <input
                  value={sv.varName}
                  onChange={(e) => onUpdate({ varName: e.target.value } as Partial<SetVarBlock>)}
                  placeholder="varName"
                  className="h-6 px-2 text-[9px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none w-[100px]"
                />
                <span className="text-[9px] text-text-4">=</span>
                <input
                  value={sv.expression}
                  onChange={(e) => onUpdate({ expression: e.target.value } as Partial<SetVarBlock>)}
                  placeholder="value or ${otherVar}"
                  className="h-6 px-2 text-[9px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none flex-1"
                />
              </div>
            )
          })()}
        </div>
      </div>
    )
  }
  ```

  **DoD:**
  - [ ] File created at `frontend/src/components/testdata/TestBlockCard.tsx`
  - [ ] Request block shows request picker from collections
  - [ ] Assert block shows source/field/operator/expected
  - [ ] SetVar block shows varName = expression
  - [ ] State icon shows running/passed/failed/skipped
  - [ ] Up/down/delete buttons work
  - [ ] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/components/testdata/TestBlockCard.tsx
  git commit -m "feat: visual-test — add TestBlockCard with request/assert/setvar forms and run state icons"
  ```

---

### Task 5: Create `VisualTestPanel.tsx`

**Files:**
- Create: `frontend/src/components/testdata/VisualTestPanel.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
  import { useState } from 'react'
  import { Plus, Play, Trash2, ChevronDown } from 'lucide-react'
  import { nanoid } from 'nanoid'
  import { useVisualTestsStore } from '@/stores/visualTests'
  import { runVisualTest } from '@/lib/visualTestRunner'
  import { TestBlockCard } from './TestBlockCard'
  import type { TestBlock, BlockResult, BlockType } from '@/lib/types'
  import { cn } from '@/lib/utils'

  const ADD_BLOCK_OPTIONS: { type: BlockType; label: string }[] = [
    { type: 'request', label: 'Request' },
    { type: 'assert', label: 'Assert' },
    { type: 'setvar', label: 'Set Variable' },
  ]

  function blankBlock(type: BlockType): TestBlock {
    switch (type) {
      case 'request': return { type, id: nanoid(), collectionItemId: '', label: '', extractVars: [] }
      case 'assert': return { type, id: nanoid(), label: '', source: 'body', field: '$.status', operator: 'eq', expected: '200' }
      case 'setvar': return { type, id: nanoid(), varName: '', expression: '' }
      default: return { type: 'setvar', id: nanoid(), varName: '', expression: '' }
    }
  }

  export function VisualTestPanel() {
    const { tests, addTest, updateTest, removeTest, addBlock, updateBlock, removeBlock, moveBlock } = useVisualTestsStore()
    const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
    const [blockResults, setBlockResults] = useState<Record<string, BlockResult>>({})
    const [running, setRunning] = useState(false)
    const [showAddMenu, setShowAddMenu] = useState(false)
    const [runSummary, setRunSummary] = useState<{ passed: boolean; durationMs: number } | null>(null)

    const test = tests.find((t) => t.id === selectedTestId)

    const handleRun = async () => {
      if (!test) return
      setRunning(true)
      setBlockResults({})
      setRunSummary(null)
      const result = await runVisualTest(test, (id, br) => {
        setBlockResults((prev) => ({ ...prev, [id]: br }))
      })
      setRunning(false)
      setRunSummary({ passed: result.passed, durationMs: result.durationMs })
    }

    const handleAddTest = () => {
      const id = addTest('New Test')
      setSelectedTestId(id)
    }

    return (
      <div className="flex h-full overflow-hidden">
        {/* Left: test list */}
        <div className="w-[180px] border-r border-border-1 flex flex-col bg-surface-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-1">
            <span className="text-[10px] font-semibold text-text-3 uppercase tracking-wider">Tests</span>
            <button onClick={handleAddTest} className="p-0.5 rounded hover:bg-surface-2 text-text-4 hover:text-text-1 transition-colors">
              <Plus size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {tests.map((t) => (
              <div
                key={t.id}
                onClick={() => { setSelectedTestId(t.id); setBlockResults({}); setRunSummary(null) }}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] transition-colors',
                  selectedTestId === t.id ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2'
                )}
              >
                <span className="flex-1 truncate">{t.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeTest(t.id); if (selectedTestId === t.id) setSelectedTestId(null) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-4 hover:text-red-400"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
            {tests.length === 0 && (
              <p className="px-3 py-4 text-[10px] text-text-4 text-center">No tests.<br />Click + to add one.</p>
            )}
          </div>
        </div>

        {/* Right: canvas */}
        {test ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border-1 bg-surface-1">
              <input
                value={test.name}
                onChange={(e) => updateTest(test.id, { name: e.target.value })}
                className="flex-1 h-7 px-2 text-[11px] font-medium bg-transparent border-b border-transparent hover:border-border-2 focus:border-accent text-text-1 outline-none transition-colors"
              />
              {runSummary && (
                <span className={cn('text-[9px] px-2 py-0.5 rounded', runSummary.passed ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300')}>
                  {runSummary.passed ? 'PASSED' : 'FAILED'} ({runSummary.durationMs}ms)
                </span>
              )}
              <button
                onClick={handleRun}
                disabled={running || test.blocks.length === 0}
                className="flex items-center gap-1.5 h-7 px-3 text-[10px] bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                <Play size={11} />
                {running ? 'Running…' : 'Run Test'}
              </button>
            </div>

            {/* Block canvas */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {test.blocks.map((block, idx) => (
                <TestBlockCard
                  key={block.id}
                  block={block}
                  result={blockResults[block.id]}
                  onUpdate={(patch) => updateBlock(test.id, block.id, patch)}
                  onDelete={() => removeBlock(test.id, block.id)}
                  onMoveUp={() => moveBlock(test.id, idx, idx - 1)}
                  onMoveDown={() => moveBlock(test.id, idx, idx + 1)}
                  isFirst={idx === 0}
                  isLast={idx === test.blocks.length - 1}
                />
              ))}

              {/* Add block */}
              <div className="relative">
                <button
                  onClick={() => setShowAddMenu(!showAddMenu)}
                  className="flex items-center gap-1.5 h-7 px-3 text-[10px] text-text-3 hover:text-text-1 hover:bg-surface-2 rounded border border-dashed border-border-2 w-full justify-center transition-colors"
                >
                  <Plus size={12} />
                  Add block
                  <ChevronDown size={11} />
                </button>
                {showAddMenu && (
                  <div className="absolute top-8 left-0 z-10 bg-surface-1 border border-border-1 rounded shadow-lg py-1 min-w-[140px]">
                    {ADD_BLOCK_OPTIONS.map((opt) => (
                      <button
                        key={opt.type}
                        onClick={() => { addBlock(test.id, blankBlock(opt.type)); setShowAddMenu(false) }}
                        className="w-full text-left px-3 py-2 text-[10px] text-text-2 hover:bg-surface-2 transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {test.blocks.length === 0 && (
                <p className="text-center text-[10px] text-text-4 py-8">Add blocks above to build your test.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[10px] text-text-4">
            Select a test or create one to get started.
          </div>
        )}
      </div>
    )
  }
  ```

  **DoD:**
  - [ ] File created at `frontend/src/components/testdata/VisualTestPanel.tsx`
  - [ ] Test list with add/delete
  - [ ] Block canvas with Add block dropdown
  - [ ] Run button executes test and updates block states live
  - [ ] PASSED/FAILED summary shown after run
  - [ ] Build passes

- [ ] **Step 2: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/components/testdata/VisualTestPanel.tsx
  git commit -m "feat: visual-test — add VisualTestPanel with block canvas and live run state updates"
  ```

  **DoD:**
  - [ ] Build exits 0
  - [ ] Commit created

---

### Task 6: Wire `testdata` rail item to `VisualTestPanel`

**Files:**
- Verify/modify: wherever `testdata` rail item renders its panel (likely `App.tsx`)

- [ ] **Step 1: Find where `testdata` is rendered**

  ```bash
  grep -n "testdata" frontend/src/App.tsx frontend/src/components/layout/*.tsx 2>/dev/null | head -20
  ```

  **DoD:**
  - [ ] Location found

- [ ] **Step 2: Import and mount `VisualTestPanel`**

  In the identified file:

  ```tsx
  import { VisualTestPanel } from '@/components/testdata/VisualTestPanel'
  // ...
  {activeRail === 'testdata' && <VisualTestPanel />}
  ```

  **DoD:**
  - [ ] Clicking `testdata` in the rail shows `VisualTestPanel`
  - [ ] Build passes

- [ ] **Step 3: Manual smoke test**

  Run `wails dev`. Click "Test Data" in the rail (or the relevant item). Verify:

  **DoD:**
  - [ ] `VisualTestPanel` renders
  - [ ] Create a test, add a Request block + Assert block, run → blocks show PASS/FAIL
  - [ ] Test persists after navigating away and back
  - [ ] Test persists after app restart

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/App.tsx  # or whichever file was modified
  git commit -m "feat: rail — wire testdata item to VisualTestPanel"
  ```
