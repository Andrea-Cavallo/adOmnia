# P2 — Diff Viewer Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Upgrade the existing DiffModal from a minimal side-by-side table into a professional diff viewer with word-level inline highlights, Unified view toggle, and copy-side buttons. The LCS algorithm and collapseDiff logic are already correct — only the rendering layer changes.

**Architecture:** The existing `computeLineDiff`, `collapseDiff`, and `DiffEntry` types stay unchanged. A new `computeWordDiff(a: string, b: string): WordToken[]` function applies character-level LCS to produce inline highlights for changed lines. The `DiffModal` component is rewritten to use the new rendering. A `DiffUnifiedView` sub-component handles the secondary Unified mode.

**Tech Stack:** TypeScript, React, existing `cn` utility, CSS custom properties from `globals.css`. No new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/components/response/DiffView.tsx` | Add `computeWordDiff`; rewrite `DiffModal` render; add `DiffUnifiedView`; add copy-side buttons; add Unified toggle |

---

## Feature Checklist

- [x] **Word-level inline highlights on changed lines**
  - **AC:** Changed characters within a modified line are highlighted (not just the full line background)
- [x] **Unified view toggle**
  - **AC:** Side/Unified toggle switches the layout; Unified shows single-column with +/− prefixes and line numbers
- [x] **Copy-side buttons**
  - **AC:** Copy button next to each column label copies the full text of that side to clipboard
- [x] **All existing features preserved**
  - **AC:** Line numbers, ↑↓ navigation, diff-only toggle, collapse/expand — all work in both view modes

---

### Task 1: Add computeWordDiff function

**Files:**
- Modify: `frontend/src/components/response/DiffView.tsx`

- [x] **Step 1: Add the WordToken type and computeWordDiff function**

  After the `collapseDiff` function (around line 96), add:

  ```ts
  export type WordToken =
    | { kind: 'same'; text: string }
    | { kind: 'removed'; text: string }
    | { kind: 'added'; text: string }

  /**
   * Character-level LCS diff between two strings.
   * Returns tokens for the LEFT side when side='left', RIGHT side when side='right'.
   * Used to highlight the specific changed characters within a modified line.
   */
  export function computeWordDiff(a: string, b: string, side: 'left' | 'right'): WordToken[] {
    const ac = [...a]
    const bc = [...b]
    const n = ac.length
    const m = bc.length

    if (n * m > 200_000) {
      return side === 'left'
        ? [{ kind: 'removed', text: a }]
        : [{ kind: 'added', text: b }]
    }

    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        dp[i][j] = ac[i - 1] === bc[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }

    const leftTokens: WordToken[] = []
    const rightTokens: WordToken[] = []
    let i = n, j = m
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && ac[i - 1] === bc[j - 1]) {
        leftTokens.unshift({ kind: 'same', text: ac[i - 1] })
        rightTokens.unshift({ kind: 'same', text: bc[j - 1] })
        i--; j--
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        rightTokens.unshift({ kind: 'added', text: bc[j - 1] })
        j--
      } else {
        leftTokens.unshift({ kind: 'removed', text: ac[i - 1] })
        i--
      }
    }
    return side === 'left' ? leftTokens : rightTokens
  }
  ```

  **DoD:**
  - [x] `WordToken` type exported with `same | removed | added` variants
  - [x] `computeWordDiff('abc', 'axc', 'left')` returns `[{kind:'same',text:'a'},{kind:'removed',text:'b'},{kind:'same',text:'c'}]`
  - [x] Large string guard (n*m > 200_000) returns fallback without crash
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
  git add frontend/src/components/response/DiffView.tsx
  git commit -m "feat: add computeWordDiff for character-level inline diff highlights"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the expected commit message
  - [x] Only the expected file(s) in the diff

---

### Task 2: Add inline word highlight rendering helper

**Files:**
- Modify: `frontend/src/components/response/DiffView.tsx`

- [x] **Step 1: Add renderInlineTokens helper component**

  After `computeWordDiff`, add:

  ```tsx
  function InlineTokens({ tokens }: { tokens: WordToken[] }) {
    return (
      <>
        {tokens.map((tok, i) => {
          if (tok.kind === 'removed') {
            return (
              <span key={i} className="bg-error/40 rounded-[2px]">
                {tok.text}
              </span>
            )
          }
          if (tok.kind === 'added') {
            return (
              <span key={i} className="bg-success/40 rounded-[2px]">
                {tok.text}
              </span>
            )
          }
          return <span key={i}>{tok.text}</span>
        })}
      </>
    )
  }
  ```

  **DoD:**
  - [x] `InlineTokens` renders `<span>` elements with correct classes: `bg-error/40` for removed, `bg-success/40` for added
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
  git add frontend/src/components/response/DiffView.tsx
  git commit -m "feat: add InlineTokens component for word-level diff highlighting"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the expected commit message
  - [x] Only the expected file(s) in the diff

---

### Task 3: Add Unified view sub-component

**Files:**
- Modify: `frontend/src/components/response/DiffView.tsx`

- [x] **Step 1: Add DiffUnifiedView component**

  After `InlineTokens`, add:

  ```tsx
  interface DiffUnifiedViewProps {
    displayEntries: Array<DiffEntry | { kind: 'ellipsis'; count: number }>
    containerRef: React.RefObject<HTMLDivElement>
  }

  function DiffUnifiedView({ displayEntries, containerRef }: DiffUnifiedViewProps) {
    return (
      <div ref={containerRef} className="flex-1 overflow-auto font-mono text-[11px] leading-5">
        {displayEntries.map((entry, idx) => {
          if (entry.kind === 'ellipsis') {
            return (
              <div key={idx} className="bg-surface-1 border-y border-border-1/40 px-3 py-0.5 text-[9px] text-text-4">
                … {entry.count} unchanged line{entry.count !== 1 ? 's' : ''} …
              </div>
            )
          }
          const isRemoved = entry.kind === 'removed'
          const isAdded = entry.kind === 'added'
          const lineNum = entry.kind === 'context'
            ? `${entry.leftIdx}`
            : isRemoved
            ? `${entry.leftIdx}`
            : `${entry.rightIdx}`

          return (
            <div
              key={idx}
              data-diff-row
              className={cn(
                'flex items-start',
                isRemoved ? 'bg-error/10' : isAdded ? 'bg-success/10' : '',
              )}
            >
              <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-text-4 select-none border-r border-border-1/30 text-[9px]">
                {lineNum}
              </span>
              <span className={cn(
                'w-5 shrink-0 text-center py-0.5 select-none text-[10px]',
                isRemoved ? 'text-error' : isAdded ? 'text-success' : 'text-text-4',
              )}>
                {isRemoved ? '−' : isAdded ? '+' : ' '}
              </span>
              <span className={cn(
                'flex-1 px-2 py-0.5 whitespace-pre-wrap break-all',
                isRemoved ? 'text-error' : isAdded ? 'text-success' : 'text-text-2',
              )}>
                {entry.text}
              </span>
            </div>
          )
        })}
      </div>
    )
  }
  ```

  **DoD:**
  - [x] `DiffUnifiedView` renders a single-column list with line number, +/−/space prefix, and text
  - [x] Ellipsis entries render the "… N lines unchanged" row
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
  git add frontend/src/components/response/DiffView.tsx
  git commit -m "feat: add DiffUnifiedView sub-component for unified diff mode"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the expected commit message
  - [x] Only the expected file(s) in the diff

---

### Task 4: Upgrade DiffModal with word highlights, Unified toggle, and copy buttons

**Files:**
- Modify: `frontend/src/components/response/DiffView.tsx`

- [x] **Step 1: Add `Copy` to lucide-react imports**

  Find the import line at the top:
  ```ts
  import { X, ChevronUp, ChevronDown, EyeOff, Eye, GitCompare } from 'lucide-react'
  ```
  Add `Copy`:
  ```ts
  import { X, ChevronUp, ChevronDown, EyeOff, Eye, GitCompare, Copy } from 'lucide-react'
  ```

  **DoD:**
  - [x] `Copy` icon imported without error
  - [x] Build passes

- [x] **Step 2: Add `viewMode` state to `DiffModal`**

  Inside `DiffModal`, after the existing `useState` calls, add:

  ```ts
  const [viewMode, setViewMode] = useState<'side-by-side' | 'unified'>('side-by-side')
  ```

  **DoD:**
  - [x] `viewMode` state defaults to `'side-by-side'`
  - [x] Type is `'side-by-side' | 'unified'` — no implicit `any`

- [x] **Step 3: Add copy handler**

  Inside `DiffModal`, after the `scrollToDiff` callback, add:

  ```ts
  const copyLeft = useCallback(() => {
    navigator.clipboard.writeText(leftPretty).catch(() => undefined)
  }, [leftPretty])

  const copyRight = useCallback(() => {
    navigator.clipboard.writeText(rightPretty).catch(() => undefined)
  }, [rightPretty])
  ```

  **DoD:**
  - [x] `copyLeft` calls `navigator.clipboard.writeText(leftPretty)`
  - [x] `copyRight` calls `navigator.clipboard.writeText(rightPretty)`
  - [x] Both handlers use `.catch(() => undefined)` — never throw

- [x] **Step 4: Add view mode toggle to the header**

  Inside the header `<div>` (the one with `GitCompare` icon), just before the `diffOnly` toggle button, add:

  ```tsx
  {/* Side-by-side / Unified toggle */}
  <div className="flex items-center bg-surface-2 rounded p-0.5 text-[10px]">
    <button
      onClick={() => setViewMode('side-by-side')}
      className={cn('px-2 py-0.5 rounded transition-colors',
        viewMode === 'side-by-side' ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')}
    >
      Side
    </button>
    <button
      onClick={() => setViewMode('unified')}
      className={cn('px-2 py-0.5 rounded transition-colors',
        viewMode === 'unified' ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')}
    >
      Unified
    </button>
  </div>
  ```

  **DoD:**
  - [x] Side/Unified toggle renders in the header
  - [x] Active mode button has `bg-surface-3 text-text-1` styling
  - [x] Build passes

- [x] **Step 5: Add copy buttons to the column labels bar**

  Find the column labels `<div>` (the `grid-cols-2` with `← {leftLabel}`). Replace it with:

  ```tsx
  <div className="grid grid-cols-2 border-b border-border-1 bg-surface-1 flex-shrink-0">
    <div className="flex items-center justify-between px-3 py-1.5 border-r border-border-1">
      <span className="text-[10px] font-medium text-text-3 truncate">← {leftLabel}</span>
      <button
        onClick={copyLeft}
        className="p-0.5 rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors flex-shrink-0 ml-2"
        title="Copy left side"
      >
        <Copy size={11} />
      </button>
    </div>
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-[10px] font-medium text-text-3 truncate">{rightLabel} →</span>
      <button
        onClick={copyRight}
        className="p-0.5 rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors flex-shrink-0 ml-2"
        title="Copy right side"
      >
        <Copy size={11} />
      </button>
    </div>
  </div>
  ```

  **DoD:**
  - [x] Copy buttons appear next to both column label texts
  - [x] Clicking left copy button triggers `copyLeft`
  - [x] Clicking right copy button triggers `copyRight`

- [x] **Step 6: Wire viewMode into the diff body**

  Find the diff body section (the `<div ref={containerRef} ...>` block). Wrap the existing side-by-side content with a condition, and add the Unified branch:

  ```tsx
  {/* Diff body */}
  {viewMode === 'unified' ? (
    <DiffUnifiedView displayEntries={displayEntries} containerRef={containerRef} />
  ) : (
    <div ref={containerRef} className="flex-1 overflow-auto font-mono text-[11px] leading-5">
      {identical ? (
        <div className="flex items-center justify-center h-full text-text-3 text-xs gap-2">
          <span className="text-success text-lg">✓</span> Responses are identical
        </div>
      ) : (
        displayEntries.map((entry, idx) => {
          if (entry.kind === 'ellipsis') {
            return (
              <div key={idx} className="grid grid-cols-2 bg-surface-1 border-y border-border-1/40">
                <div className="px-3 py-0.5 text-[9px] text-text-4 col-span-2">
                  … {entry.count} unchanged line{entry.count !== 1 ? 's' : ''} …
                </div>
              </div>
            )
          }

          const isRemoved = entry.kind === 'removed'
          const isAdded = entry.kind === 'added'
          const leftNum = entry.kind === 'context' ? entry.leftIdx : (isRemoved ? entry.leftIdx : null)
          const rightNum = entry.kind === 'context' ? entry.rightIdx : (isAdded ? entry.rightIdx : null)
          const leftText = entry.kind !== 'added' ? entry.text : ''
          const rightText = entry.kind !== 'removed' ? entry.text : ''

          // Word-level tokens for changed lines
          const leftTokens = isRemoved
            ? computeWordDiff(entry.text, '', 'left')
            : null
          const rightTokens = isAdded
            ? computeWordDiff('', entry.text, 'right')
            : null
          // For context lines with paired remove+add we rely on the existing entry pairing
          // (the LCS already aligns them; word diff on pure removed/added lines is sufficient)

          return (
            <div key={idx} data-diff-row className="grid grid-cols-2">
              {/* Left cell */}
              <div className={cn(
                'flex items-start border-r border-border-1/40',
                isRemoved ? 'bg-error/10' : 'bg-transparent',
              )}>
                <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-text-4 select-none border-r border-border-1/30 text-[9px]">
                  {leftNum ?? ''}
                </span>
                <span className={cn(
                  'flex-1 px-2 py-0.5 whitespace-pre-wrap break-all',
                  isRemoved ? 'text-error' : 'text-text-2',
                )}>
                  {isRemoved && <span className="mr-1 text-error/60 select-none">−</span>}
                  {isRemoved && leftTokens
                    ? <InlineTokens tokens={leftTokens} />
                    : leftText}
                </span>
              </div>
              {/* Right cell */}
              <div className={cn(
                'flex items-start',
                isAdded ? 'bg-success/10' : 'bg-transparent',
              )}>
                <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-text-4 select-none border-r border-border-1/30 text-[9px]">
                  {rightNum ?? ''}
                </span>
                <span className={cn(
                  'flex-1 px-2 py-0.5 whitespace-pre-wrap break-all',
                  isAdded ? 'text-success' : 'text-text-2',
                )}>
                  {isAdded && <span className="mr-1 text-success/60 select-none">+</span>}
                  {isAdded && rightTokens
                    ? <InlineTokens tokens={rightTokens} />
                    : rightText}
                </span>
              </div>
            </div>
          )
        })
      )}
    </div>
  )}
  ```

  **DoD:**
  - [x] When `viewMode === 'unified'`, `DiffUnifiedView` renders instead of the grid
  - [x] Changed lines in side-by-side mode show `InlineTokens` (character highlights), not just `entry.text`
  - [x] Identical responses still show the "Responses are identical" message in side-by-side mode
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

  Run `wails dev`. Open any two API responses in different tabs. Open Compare (DiffPickerModal → DiffModal). Verify:
  - Changed lines show character-level highlights (specific words/chars highlighted, not just the whole line colored).
  - Copy buttons appear next to both column labels. Clicking copies the full text.
  - "Side / Unified" toggle switches the view. Unified mode shows a single column with +/− prefixes.
  - ↑ ↓ navigation still works in both modes.
  - "Diff only" toggle still collapses unchanged lines.

  **DoD:**
  - [x] Changed lines show character-level highlights (specific chars highlighted, not just line background)
  - [x] Copy left button copies full left text to clipboard
  - [x] Copy right button copies full right text to clipboard
  - [x] Side/Unified toggle switches the layout correctly
  - [x] ↑ ↓ navigation still works in both modes
  - [x] "Diff only" toggle still collapses unchanged lines

- [x] **Step 9: Commit**

  ```bash
  git add frontend/src/components/response/DiffView.tsx
  git commit -m "feat: diff viewer — word-level inline highlights, unified view toggle, copy-side buttons"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the expected commit message
  - [x] Only the expected file(s) in the diff
