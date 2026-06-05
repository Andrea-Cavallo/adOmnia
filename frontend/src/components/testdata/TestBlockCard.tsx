import type { ReactNode } from 'react'
import { Trash2, ChevronUp, ChevronDown, CheckCircle2, XCircle, Loader2, SkipForward } from 'lucide-react'
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

const STATE_ICONS: Record<string, ReactNode> = {
  running: <Loader2 size={12} className="animate-spin text-warning" />,
  passed: <CheckCircle2 size={12} className="text-success" />,
  failed: <XCircle size={12} className="text-error" />,
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

// Left-border accent per block type, using the app's method/status color tokens.
const BLOCK_BORDER: Record<string, string> = {
  request: 'border-l-[var(--color-method-get)]',
  assert: 'border-l-[var(--color-success)]',
  setvar: 'border-l-[var(--color-warning)]',
  if: 'border-l-[var(--color-accent)]',
  loop: 'border-l-[var(--color-method-patch)]',
}

export function TestBlockCard({ block, result, onUpdate, onDelete, onMoveUp, onMoveDown, isFirst, isLast }: Props) {
  const collections = useCollectionsStore((s) => s.collections)
  const allRequests = collections.flatMap((c) => flattenRequests(c.children ?? []))

  return (
    <div className={cn('border border-border-1 rounded bg-surface-1 border-l-2', BLOCK_BORDER[block.type])}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-1">
        <span className="text-[9px] font-semibold text-text-3 uppercase tracking-wider">{BLOCK_LABELS[block.type]}</span>
        <div className="flex-1" />
        {STATE_ICONS[result?.state ?? 'idle']}
        {result?.message && (
          <span className={cn('text-[9px] truncate max-w-[160px]', result.state === 'failed' ? 'text-error' : 'text-text-4')}>
            {result.message}
          </span>
        )}
        <button onClick={onMoveUp} disabled={isFirst} className="p-0.5 rounded hover:bg-surface-2 text-text-4 disabled:opacity-30" title="Move up">
          <ChevronUp size={11} />
        </button>
        <button onClick={onMoveDown} disabled={isLast} className="p-0.5 rounded hover:bg-surface-2 text-text-4 disabled:opacity-30" title="Move down">
          <ChevronDown size={11} />
        </button>
        <button onClick={onDelete} className="p-0.5 rounded hover:bg-surface-2 text-text-4 hover:text-error" title="Delete block">
          <Trash2 size={11} />
        </button>
      </div>

      {/* Block form */}
      <div className="px-3 py-2">
        {block.type === 'request' && (() => {
          const rb = block as RequestBlock
          return (
            <select
              value={rb.collectionItemId}
              onChange={(e) => {
                const req = allRequests.find((r) => r.id === e.target.value)
                onUpdate({ collectionItemId: e.target.value, label: req?.name ?? '' } as Partial<RequestBlock>)
              }}
              className="w-full h-6 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
            >
              <option value="">— Select request —</option>
              {allRequests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.method ?? '?'} {r.name}
                </option>
              ))}
            </select>
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
