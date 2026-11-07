/**
 * Le righe dell'albero External Libraries, comuni a ogni linguaggio: il codice di una dipendenza (modulo Go,
 * jar di sorgenti Maven) è una cartella in sola lettura che si sfoglia e si apre allo stesso modo.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { listGoIDEExternalDirectory, type GoIDEDependencySource, type GoIDEFileEntry } from '@/lib/code-studio-api'
import { CodeStudioFileIcon } from './CodeStudioFileIcon'
import { CodeStudioFolderIcon } from './CodeStudioFolderIcon'
import { openDependencySourceFile } from './codeStudioDependencySource'
import { ROW_BASE_PX, ROW_INDENT_PX, TREE_ICON_PX, TreeChevron } from './codeStudioTreeRow'

export function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function indent(depth: number): number {
  return ROW_BASE_PX + (depth - 1) * ROW_INDENT_PX
}

interface ExternalRowProps {
  depth: number
  title: string
  selected?: boolean
  muted?: boolean
  /** Presente sulle righe che si aprono: frecce sinistra/destra come nel resto dell'albero. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onActivate?: () => void
  children: ReactNode
}

export function ExternalRow({ depth, title, selected = false, muted = false, open, onOpenChange, onActivate, children }: ExternalRowProps) {
  const row = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <button
      ref={row}
      type="button"
      role="treeitem"
      data-tree-external
      aria-level={depth}
      aria-expanded={open}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      title={title}
      onClick={onOpenChange ? () => onOpenChange(!open) : onActivate}
      onKeyDown={(event) => {
        if (!onOpenChange || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        if (event.key === 'ArrowRight' && !open) { event.preventDefault(); onOpenChange(true) }
        if (event.key === 'ArrowLeft' && open) { event.preventDefault(); onOpenChange(false) }
      }}
      className={`code-studio-tree-row flex h-7 w-full items-center gap-1.5 overflow-hidden rounded pr-2 text-left text-xs transition-colors ${selected ? 'code-studio-tree-row-selected' : `hover:bg-surface-2/60 hover:text-text-1 ${muted ? 'text-text-3' : 'text-text-2'}`}`}
      style={{ paddingLeft: indent(depth) }}
    >
      {children}
    </button>
  )
}

/** Riga informativa sotto un modulo: caricamento, errore o motivo per cui il codice non c'è. */
export function ExternalNote({ depth, tone = 'text-text-4', children }: { depth: number; tone?: string; children: ReactNode }) {
  return <div className={`flex min-h-6 items-center gap-1.5 pr-2 text-[11px] ${tone}`} style={{ paddingLeft: indent(depth) + 18 }}>{children}</div>
}

interface ExternalFolderProps {
  sessionId: string
  source: GoIDEDependencySource
  /** Cartella relativa al modulo, '' per la sua radice. */
  relative: string
  depth: number
  revealFile: string | null
}

// ponytail: nessuna paginazione, il backend taglia a MaxDirectoryItems; una cartella di modulo è piccola.
export function ExternalFolder({ sessionId, source, relative, depth, revealFile }: ExternalFolderProps) {
  const [entries, setEntries] = useState<GoIDEFileEntry[] | null>(null)
  const [error, setError] = useState('')
  const directory = relative ? `${source.directory}/${relative}` : source.directory ?? ''
  useEffect(() => {
    let current = true
    const request = listGoIDEExternalDirectory(sessionId, directory)
    request.then((next) => { if (current) setEntries(next) }).catch((reason: unknown) => { if (current) setError(reasonText(reason)) })
    return () => { current = false; request.cancel() }
  }, [directory, sessionId])
  if (error) return <ExternalNote depth={depth} tone="text-danger">{error}</ExternalNote>
  if (!entries) return <ExternalNote depth={depth}><Loader2 size={12} className="animate-spin" /> Reading the folder…</ExternalNote>
  if (entries.length === 0) return <ExternalNote depth={depth}>This folder is empty.</ExternalNote>
  return <div role="group" className="code-studio-tree-branch" style={{ '--tree-guide-x': `${indent(depth - 1) + 6}px` } as React.CSSProperties}>
    {entries.map((entry) => <ExternalEntry key={entry.name} sessionId={sessionId} source={source} entry={entry} relative={relative} depth={depth} revealFile={revealFile} />)}
  </div>
}

function ExternalEntry({ entry, ...folder }: ExternalFolderProps & { entry: GoIDEFileEntry }) {
  const { sessionId, source, relative, depth, revealFile } = folder
  const path = relative ? `${relative}/${entry.name}` : entry.name
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (entry.directory && revealFile?.startsWith(`${path}/`)) setOpen(true)
  }, [entry.directory, path, revealFile])
  if (!entry.directory) {
    return (
      <ExternalRow depth={depth} title={`${source.modulePath}/${path}`} selected={revealFile === path} onActivate={() => { openDependencySourceFile(source, sessionId, path) }}>
        <span className="w-3 shrink-0" />
        <CodeStudioFileIcon name={entry.name} relativePath={path} size={TREE_ICON_PX} />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </ExternalRow>
    )
  }
  return (
    <>
      <ExternalRow depth={depth} title={`${source.modulePath}/${path}`} open={open} onOpenChange={setOpen}>
        <TreeChevron open={open} />
        <CodeStudioFolderIcon open={open} size={TREE_ICON_PX} />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </ExternalRow>
      {open && <ExternalFolder sessionId={sessionId} source={source} relative={path} depth={depth + 1} revealFile={revealFile} />}
    </>
  )
}

