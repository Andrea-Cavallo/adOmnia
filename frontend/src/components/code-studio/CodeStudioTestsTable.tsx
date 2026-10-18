import { useMemo, useState } from 'react'
import { Bug, ChevronDown, ChevronRight, ChevronUp, Folder, MoreHorizontal, Play } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { buildTestTree, formatDuration } from '@/lib/code-studio/codeStudioTestTree'
import { relativeTime, type TestSuite } from '@/lib/code-studio/testSuites'
import { StatusIcon } from './CodeStudioTestParts'
import { LanguageChip, StatusPill } from './CodeStudioTestsUi'

const COLUMNS = 'grid-cols-[minmax(180px,1fr)_64px_88px_64px_80px_84px]'

interface CodeStudioTestsTableProps {
  suites: TestSuite[]
  selectedKey: string
  expanded: ReadonlySet<string>
  ascending: boolean
  now: number
  onSort: () => void
  onSelect: (key: string) => void
  onToggle: (key: string) => void
  onSelectPackage: (suite: TestSuite, nodeId: string) => void
  onRun: (suite: TestSuite) => void
  onDebug: (suite: TestSuite) => void
  canDebug: (suite: TestSuite) => boolean
  rowMenu: (suite: TestSuite) => ContextMenuItem[]
  onRowMenu: (suite: TestSuite, id: string) => void
}

const iconButton = 'grid h-6 w-6 place-items-center rounded text-text-3 transition-colors hover:border-accent hover:bg-surface-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-border-1 disabled:hover:bg-surface-2 disabled:hover:text-text-2'

function PackageRows({ suite, onSelect }: { suite: TestSuite; onSelect: (nodeId: string) => void }) {
  const nodes = useMemo(() => buildTestTree(suite.run?.results ?? []), [suite.run?.results])
  if (nodes.length === 0) return <p className="py-2 pl-10 text-[12px] text-text-4">{suite.run ? 'No tests reported by the last run.' : 'Not run yet.'}</p>
  return (
    <ul className="border-t border-border-1/60 bg-surface-2/40 py-1">
      {nodes.map((node) => (
        <li key={node.result.id}>
          <button type="button" onClick={() => onSelect(node.result.id)} className={`grid w-full items-center gap-2 py-1.5 pl-10 pr-4 text-left text-[12px] text-text-2 hover:bg-surface-3 ${COLUMNS}`}>
            <span className="flex min-w-0 items-center gap-2"><StatusIcon status={node.result.status} /><span className="truncate font-mono text-[12px]">{node.label}</span></span>
            <span />
            <span className="text-[12px] text-text-3">{node.children.length > 0 ? `${node.children.length} tests` : ''}</span>
            <span className="text-[12px] tabular-nums text-text-3">{node.result.elapsedMillis > 0 ? formatDuration(node.result.elapsedMillis) : ''}</span>
            <span /><span />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Tabella delle suite: una riga per unità testabile con stato, durata, ultima esecuzione e azioni; la riga si espande nei package. */
export function CodeStudioTestsTable({ suites, selectedKey, expanded, ascending, now, onSort, onSelect, onToggle, onSelectPackage, onRun, onDebug, canDebug, rowMenu, onRowMenu }: CodeStudioTestsTableProps) {
  const [menu, setMenu] = useState<{ suite: TestSuite; x: number; y: number } | null>(null)
  const SortIcon = ascending ? ChevronUp : ChevronDown
  return (
    <section aria-label="Test suites" className="min-w-0 overflow-x-auto border border-border-1 bg-surface-0">
      <div className={`grid min-w-[620px] items-center gap-2 border-b border-border-1 px-2 py-1.5 text-[12px] font-medium text-text-3 ${COLUMNS}`}>
        <button type="button" onClick={onSort} aria-label={`Sort by name, ${ascending ? 'ascending' : 'descending'}`} className="flex items-center gap-1 pl-8 text-left hover:text-text-1">Name <SortIcon size={12} aria-hidden="true" /></button>
        <span>Language</span><span>Status</span><span>Duration</span><span>Last Run</span><span className="text-right">Actions</span>
      </div>
      {suites.length === 0 && <p className="px-2 py-8 text-center text-[12px] text-text-4">No test suite matches.</p>}
      <ul role="treegrid" aria-label="Test suites">
        {suites.map((suite) => {
          const open = expanded.has(suite.key)
          const selected = suite.key === selectedKey
          const running = suite.status === 'running'
          return (
            <li key={suite.key} role="presentation" className="border-b border-border-1/70 last:border-b-0">
              <div
                role="row" tabIndex={0} aria-selected={selected} aria-expanded={open}
                onClick={() => onSelect(suite.key)} onDoubleClick={() => onToggle(suite.key)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(suite.key) }
                  if (event.key === 'ArrowRight' && !open) { event.preventDefault(); onToggle(suite.key) }
                  if (event.key === 'ArrowLeft' && open) { event.preventDefault(); onToggle(suite.key) }
                }}
                className={`grid min-w-[620px] cursor-default items-center gap-2 px-2 py-2 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent text-[12px] transition-colors ${COLUMNS} ${selected ? 'bg-surface-3 shadow-[inset_2px_0_0_var(--color-text-2)]' : 'hover:bg-surface-2'}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <button type="button" aria-label={open ? `Collapse ${suite.name}` : `Expand ${suite.name}`} onClick={(event) => { event.stopPropagation(); onToggle(suite.key) }} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-text-3 hover:bg-surface-3 hover:text-text-1">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                  <Folder size={14} className="shrink-0 text-text-2" aria-hidden="true" />
                  <span className="truncate font-medium text-text-1">{suite.name}</span>
                  {suite.total > 0 && <span className="shrink-0 text-[12px] tabular-nums text-text-4">{suite.failed > 0 ? `${suite.failed}/${suite.total}` : suite.total}</span>}
                </span>
                <span><LanguageChip label={suite.languageLabel} /></span>
                <span><StatusPill status={suite.status} /></span>
                <span className="tabular-nums text-text-2">{suite.run && suite.status !== 'queued' ? formatDuration(suite.durationMs) : '—'}</span>
                <span className="text-text-3">{suite.lastRunAt ? (running ? 'now' : relativeTime(suite.lastRunAt, now)) : '—'}</span>
                <span className="flex justify-end gap-1.5">
                  <button type="button" disabled={running} aria-label={`Run ${suite.name}`} title={`Run ${suite.name}`} onClick={(event) => { event.stopPropagation(); onRun(suite) }} className={iconButton}><Play size={13} fill="currentColor" /></button>
                  <button type="button" disabled={!canDebug(suite)} aria-label={`Debug ${suite.name}`} title={canDebug(suite) ? 'Debug the first failed test' : 'Debugging starts from a failed Go or Java test'} onClick={(event) => { event.stopPropagation(); onDebug(suite) }} className={iconButton}><Bug size={14} /></button>
                  <button type="button" aria-label={`More actions for ${suite.name}`} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ suite, x: rect.right - 232, y: rect.bottom + 4 }) }} className={iconButton}><MoreHorizontal size={15} /></button>
                </span>
              </div>
              {open && <PackageRows suite={suite} onSelect={(nodeId) => onSelectPackage(suite, nodeId)} />}
            </li>
          )
        })}
      </ul>
      {menu && <ContextMenu x={Math.max(8, menu.x)} y={menu.y} items={rowMenu(menu.suite)} appearance="studio" onSelect={(id) => { onRowMenu(menu.suite, id); setMenu(null) }} onClose={() => setMenu(null)} />}
    </section>
  )
}
