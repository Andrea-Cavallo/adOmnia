import { useState } from 'react'
import { Plus, Play, Trash2, ChevronDown, GitBranch } from 'lucide-react'
import { uid, type RequestItem } from '@/lib/types'
import { useVisualTestsStore } from '@/stores/visualTests'
import { useCollectionsStore } from '@/stores/collections'
import { runVisualTest } from '@/lib/visualTestRunner'
import { visualTestToFlow } from '@/lib/visualTestToFlow'
import { loadFlowDefinitions, saveFlowDefinitions } from '@/lib/flowStorage'
import { TestBlockCard } from './TestBlockCard'
import type { TestBlock, BlockResult, BlockType } from '@/lib/types'
import { cn } from '@/lib/utils'

function flattenRequests(children: unknown[]): RequestItem[] {
  const result: RequestItem[] = []
  for (const child of children) {
    const c = child as { type?: string; children?: unknown[] } & RequestItem
    if (c.type === 'request' || !c.children) result.push(c)
    else if (c.children) result.push(...flattenRequests(c.children))
  }
  return result
}

const ADD_BLOCK_OPTIONS: { type: BlockType; label: string }[] = [
  { type: 'request', label: 'Request' },
  { type: 'assert', label: 'Assert' },
  { type: 'setvar', label: 'Set Variable' },
]

function blankBlock(type: BlockType): TestBlock {
  switch (type) {
    case 'request':
      return { type, id: uid(), collectionItemId: '', label: '', extractVars: [] }
    case 'assert':
      return { type, id: uid(), label: '', source: 'status', field: 'status', operator: 'eq', expected: '200' }
    case 'setvar':
      return { type, id: uid(), varName: '', expression: '' }
    default:
      return { type: 'setvar', id: uid(), varName: '', expression: '' }
  }
}

export function VisualTestPanel() {
  const { tests, addTest, updateTest, removeTest, addBlock, updateBlock, removeBlock, moveBlock } = useVisualTestsStore()
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
  const [blockResults, setBlockResults] = useState<Record<string, BlockResult>>({})
  const [running, setRunning] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [runSummary, setRunSummary] = useState<{ passed: boolean; durationMs: number } | null>(null)
  const [exportMsg, setExportMsg] = useState('')

  const test = tests.find((t) => t.id === selectedTestId)

  const handleExportToFlow = async () => {
    if (!test) return
    setExportMsg('')
    try {
      const allRequests = useCollectionsStore.getState().collections.flatMap((c) => flattenRequests(c.children ?? []))
      const flow = visualTestToFlow(test, allRequests)
      const existing = await loadFlowDefinitions()
      await saveFlowDefinitions([...existing, flow])
      setExportMsg(`Exported to Flows as "${flow.name}"`)
    } catch (e) {
      setExportMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

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
    setBlockResults({})
    setRunSummary(null)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: test list */}
      <div className="w-[180px] border-r border-border-1 flex flex-col bg-surface-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-1">
          <span className="text-[10px] font-semibold text-text-3 uppercase tracking-wider">Tests</span>
          <button onClick={handleAddTest} className="p-0.5 rounded hover:bg-surface-2 text-text-4 hover:text-text-1 transition-colors" title="New test">
            <Plus size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {tests.map((t) => (
            <div
              key={t.id}
              onClick={() => {
                setSelectedTestId(t.id)
                setBlockResults({})
                setRunSummary(null)
                setExportMsg('')
              }}
              className={cn(
                'group flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] transition-colors',
                selectedTestId === t.id ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2',
              )}
            >
              <span className="flex-1 truncate">{t.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeTest(t.id)
                  if (selectedTestId === t.id) setSelectedTestId(null)
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-4 hover:text-error"
                title="Delete test"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
          {tests.length === 0 && (
            <p className="px-3 py-4 text-[10px] text-text-4 text-center">
              No tests.
              <br />
              Click + to add one.
            </p>
          )}
        </div>
      </div>

      {/* Right: canvas */}
      {test ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border-1 bg-surface-1">
            <input
              value={test.name}
              onChange={(e) => updateTest(test.id, { name: e.target.value })}
              className="flex-1 h-7 px-2 text-[11px] font-medium bg-transparent border-b border-transparent hover:border-border-2 focus:border-accent text-text-1 outline-none transition-colors"
            />
            {runSummary && (
              <span
                className={cn(
                  'text-[9px] px-2 py-0.5 rounded',
                  runSummary.passed ? 'bg-success/15 text-success' : 'bg-error/15 text-error',
                )}
              >
                {runSummary.passed ? 'PASSED' : 'FAILED'} ({runSummary.durationMs}ms)
              </span>
            )}
            <button
              onClick={() => void handleExportToFlow()}
              disabled={test.blocks.length === 0}
              className="flex items-center gap-1.5 h-7 px-3 text-[10px] text-text-3 rounded border border-border-2 hover:text-text-1 hover:bg-surface-2 disabled:opacity-40 transition-colors"
              title="Export this test as a new Flow"
            >
              <GitBranch size={11} />
              Export to Flow
            </button>
            <button
              onClick={handleRun}
              disabled={running || test.blocks.length === 0}
              className="flex items-center gap-1.5 h-7 px-3 text-[10px] bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40 transition-colors"
            >
              <Play size={11} />
              {running ? 'Running…' : 'Run Test'}
            </button>
          </div>

          {exportMsg && (
            <div className="px-4 py-1.5 text-[10px] text-text-3 border-b border-border-1 bg-surface-1">{exportMsg}</div>
          )}

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
                      onClick={() => {
                        addBlock(test.id, blankBlock(opt.type))
                        setShowAddMenu(false)
                      }}
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
