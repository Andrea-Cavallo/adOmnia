import { useState, useMemo } from 'react'
import { FolderTree, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { safeSelectFolder, downloadText } from '@/lib/fileUtils'
import { CompareFolders, ReadFolderDiffFile } from '@/wailsjs/go/main/App'

export type FolderDiffStatus = 'same' | 'modified' | 'left-only' | 'right-only' | 'type-change'
type FolderDiffPreviewState = 'ok' | 'missing' | 'binary' | 'too-large' | 'directory' | 'error'

export interface FolderDiffNode {
  path: string
  name: string
  isDir: boolean
  status: FolderDiffStatus
  leftSize?: number
  rightSize?: number
  leftModified?: number
  rightModified?: number
  binary?: boolean
  children?: FolderDiffNode[]
}

export interface FolderDiffFlat {
  path: string
  status: FolderDiffStatus
  isDir: boolean
  leftSize?: number
  rightSize?: number
  leftModified?: number
  rightModified?: number
  binary?: boolean
}

export interface FolderDiffResult {
  scanId: string
  leftRoot: string
  rightRoot: string
  tree: FolderDiffNode[]
  flat: FolderDiffFlat[]
  counts: Record<FolderDiffStatus, number>
}

export interface FolderDiffPreview {
  path: string
  left: string
  right: string
  leftState?: FolderDiffPreviewState
  rightState?: FolderDiffPreviewState
  leftError?: string
  rightError?: string
}

const FOLDER_DIFF_STATUS_LABEL: Record<FolderDiffStatus, string> = {
  same: 'Same',
  modified: 'Modified',
  'left-only': 'Left only',
  'right-only': 'Right only',
  'type-change': 'Type changed',
}

const FOLDER_DIFF_STATUS_CLASS: Record<FolderDiffStatus, string> = {
  same: 'border-border-2 bg-surface-2 text-text-4',
  modified: 'border-warning/30 bg-warning/10 text-warning',
  'left-only': 'border-accent/30 bg-accent/10 text-accent-light',
  'right-only': 'border-info/30 bg-info/10 text-info',
  'type-change': 'border-error/30 bg-error/10 text-error',
}

const EMPTY_COUNTS: Record<FolderDiffStatus, number> = {
  same: 0,
  modified: 0,
  'left-only': 0,
  'right-only': 0,
  'type-change': 0,
}

function normalizeStatus(status: unknown): FolderDiffStatus {
  return status === 'modified' || status === 'left-only' || status === 'right-only' || status === 'type-change' ? status : 'same'
}

function normalizePreviewState(value: unknown, error?: string, text?: string): FolderDiffPreviewState {
  if (value === 'ok' || value === 'missing' || value === 'binary' || value === 'too-large' || value === 'directory' || value === 'error') return value
  const lower = (error ?? '').toLowerCase()
  if (lower.includes('cannot find') || lower.includes('not found') || lower.includes('no such file')) return 'missing'
  if (lower.includes('binary')) return 'binary'
  if (lower.includes('too large')) return 'too-large'
  if (lower.includes('directory')) return 'directory'
  if (error) return 'error'
  return text ? 'ok' : 'ok'
}

function previewStateLabel(state: FolderDiffPreviewState) {
  if (state === 'ok') return 'Present'
  if (state === 'missing') return 'Missing'
  if (state === 'binary') return 'Binary'
  if (state === 'too-large') return 'Too large'
  if (state === 'directory') return 'Directory'
  return 'Error'
}

function cleanPreviewError(state: FolderDiffPreviewState, error?: string) {
  if (!error || state === 'missing') return ''
  return error
}

function normalizeNode(node: Partial<FolderDiffNode> | null | undefined): FolderDiffNode {
  return {
    path: node?.path ?? '',
    name: node?.name ?? node?.path ?? '',
    isDir: node?.isDir ?? false,
    status: normalizeStatus(node?.status),
    leftSize: node?.leftSize,
    rightSize: node?.rightSize,
    leftModified: node?.leftModified,
    rightModified: node?.rightModified,
    binary: node?.binary ?? false,
    children: Array.isArray(node?.children) ? node.children.map((child) => normalizeNode(child)) : [],
  }
}

function normalizeFlat(entry: Partial<FolderDiffFlat> | null | undefined): FolderDiffFlat {
  return {
    path: entry?.path ?? '',
    status: normalizeStatus(entry?.status),
    isDir: entry?.isDir ?? false,
    leftSize: entry?.leftSize,
    rightSize: entry?.rightSize,
    leftModified: entry?.leftModified,
    rightModified: entry?.rightModified,
    binary: entry?.binary ?? false,
  }
}

function normalizeFolderDiffResult(data: Partial<FolderDiffResult> | null | undefined): FolderDiffResult {
  return {
    scanId: data?.scanId ?? '',
    leftRoot: data?.leftRoot ?? '',
    rightRoot: data?.rightRoot ?? '',
    tree: Array.isArray(data?.tree) ? data.tree.map((node) => normalizeNode(node)) : [],
    flat: Array.isArray(data?.flat) ? data.flat.map((entry) => normalizeFlat(entry)).filter((entry) => entry.path) : [],
    counts: { ...EMPTY_COUNTS, ...(data?.counts ?? {}) },
  }
}

async function parseResponseJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.text()).trim() || `Request failed with HTTP ${res.status}`)
  return await res.json() as T
}

async function parseWailsJson<T>(raw: string): Promise<T> {
  return JSON.parse(raw) as T
}

function formatDiffBytes(size?: number) {
  if (size == null) return '-'
  if (size === 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function findFolderDiffNode(nodes: FolderDiffNode[], path: string): FolderDiffNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    const child = node.children ? findFolderDiffNode(node.children, path) : null
    if (child) return child
  }
  return null
}

function FolderDiffPreviewPane({ preview }: { preview: FolderDiffPreview }) {
  const leftState = preview.leftState ?? normalizePreviewState(undefined, preview.leftError, preview.left)
  const rightState = preview.rightState ?? normalizePreviewState(undefined, preview.rightError, preview.right)
  const leftLines = leftState === 'ok' ? preview.left.split(/\r?\n/) : []
  const rightLines = rightState === 'ok' ? preview.right.split(/\r?\n/) : []
  const total = Math.max(leftLines.length, rightLines.length)
  const lines = Array.from({ length: Math.min(total, 500) }, (_, index) => ({
    number: index + 1,
    left: leftLines[index] ?? '',
    right: rightLines[index] ?? '',
    changed: leftLines[index] !== rightLines[index],
    leftMissing: index >= leftLines.length,
    rightMissing: index >= rightLines.length,
  }))

  return (
    <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-2">
      {(['left', 'right'] as const).map((side) => (
        <div key={side} className="min-h-0 overflow-hidden rounded border border-border-1 bg-surface-1">
          {(() => {
            const state = side === 'left' ? leftState : rightState
            const rawError = side === 'left' ? preview.leftError : preview.rightError
            const error = cleanPreviewError(state, rawError)
            return (
              <div className="flex h-9 min-w-0 items-center gap-2 border-b border-border-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-3">
                <span>{side === 'left' ? 'Left' : 'Right'}</span>
                <span
                  title={error || previewStateLabel(state)}
                  className={cn(
                    'ml-auto rounded border px-2 py-0.5 text-[10px] normal-case tracking-normal',
                    state === 'ok' && 'border-success/30 bg-success/10 text-success',
                    state === 'missing' && 'border-error/30 bg-error/10 text-error',
                    state === 'binary' && 'border-warning/30 bg-warning/10 text-warning',
                    state === 'too-large' && 'border-warning/30 bg-warning/10 text-warning',
                    state === 'directory' && 'border-border-2 bg-surface-2 text-text-4',
                    state === 'error' && 'border-error/30 bg-error/10 text-error',
                  )}
                >
                  {previewStateLabel(state)}
                </span>
                {error && <span className="max-w-[220px] truncate normal-case tracking-normal text-error" title={error}>{error}</span>}
              </div>
            )
          })()}
          <div className="max-h-[420px] overflow-auto text-[11px]">
            {total === 0 ? (
              <div className="grid min-h-[180px] place-items-center px-4 text-center text-xs text-text-4">
                {side === 'left' ? previewStateLabel(leftState) : previewStateLabel(rightState)}
              </div>
            ) : lines.map((line) => {
              const text = side === 'left' ? line.left : line.right
              const missing = side === 'left' ? line.leftMissing : line.rightMissing
              return (
                <div
                  key={`${side}-${line.number}`}
                  className={cn(
                    'grid grid-cols-[44px_minmax(0,1fr)] border-b border-border-1/50 font-mono leading-5',
                    line.changed && !missing && side === 'left' && 'bg-error/10 text-text-1',
                    line.changed && !missing && side === 'right' && 'bg-success/10 text-text-1',
                    !line.changed && !missing && 'text-text-2',
                    missing && 'bg-surface-2 text-text-4',
                  )}
                >
                  <span className="select-none border-r border-border-1 px-2 text-right text-text-4">{line.number}</span>
                  <span className={cn('min-w-0 overflow-x-auto whitespace-pre px-2', missing && 'italic')}>{missing ? '(missing)' : text}</span>
                </div>
              )
            })}
            {total > lines.length && <div className="px-3 py-2 text-[10px] text-text-4">Preview limited to first {lines.length} lines.</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

export function FolderDiffTool() {
  const port = useServerPort()
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [maxFileMB, setMaxFileMB] = useState(20)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<FolderDiffResult | null>(null)
  const [selected, setSelected] = useState<FolderDiffNode | null>(null)
  const [preview, setPreview] = useState<FolderDiffPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [filter, setFilter] = useState<FolderDiffStatus | 'all'>('all')

  const visibleEntries = useMemo(() => {
    if (!result) return []
    return result.flat.filter((entry) => filter === 'all' || entry.status === filter)
  }, [filter, result])

  const selectFolder = async (side: 'left' | 'right') => {
    try {
      const path = await safeSelectFolder(side === 'left' ? 'Select left folder' : 'Select right folder')
      if (!path) return
      if (side === 'left') setLeft(path)
      else setRight(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Folder selection failed.')
    }
  }

  const scan = async () => {
    if (!left.trim() || !right.trim()) {
      setError('Select or type both left and right folder paths before comparing.')
      return
    }
    setLoading(true)
    setError('')
    setPreview(null)
    try {
      let data: FolderDiffResult | null = null
      let sidecarError = ''
      const url = serverUrl(port, '/folderdiff/scan')
      if (url) {
        try {
          const res = await sidecarFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ left, right, maxFileMB }),
          })
          data = normalizeFolderDiffResult(await parseResponseJson<FolderDiffResult>(res))
        } catch (err) {
          sidecarError = err instanceof Error ? err.message.trim() : 'Sidecar request failed.'
        }
      }
      if (!data) {
        try {
          data = normalizeFolderDiffResult(await parseWailsJson<FolderDiffResult>(await CompareFolders(left, right, maxFileMB)))
        } catch (err) {
          const fallbackError = err instanceof Error ? err.message.trim() : 'Folder comparison failed.'
          throw new Error(sidecarError ? `${fallbackError} Sidecar error: ${sidecarError}` : fallbackError)
        }
      }
      setResult(data)
      const firstInteresting = data.flat.find((item) => item.status !== 'same')
      setSelected(firstInteresting ? findFolderDiffNode(data.tree, firstInteresting.path) : data.tree[0] ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message.trim() : 'Folder comparison failed.')
      setResult(null)
      setSelected(null)
    } finally {
      setLoading(false)
    }
  }

  const loadPreview = async (node: FolderDiffNode) => {
    if (!result || node.isDir || node.binary) return
    setPreviewLoading(true)
    setPreview(null)
    try {
      let previewData: FolderDiffPreview | null = null
      let sidecarError = ''
      const payload = { scanId: result.scanId, path: node.path, maxBytes: maxFileMB * 1024 * 1024 }
      const url = serverUrl(port, '/folderdiff/file')
      if (url) {
        try {
          const res = await sidecarFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          previewData = await parseResponseJson<FolderDiffPreview>(res)
        } catch (err) {
          sidecarError = err instanceof Error ? err.message.trim() : 'Sidecar preview failed.'
        }
      }
      if (!previewData) {
        try {
          previewData = await parseWailsJson<FolderDiffPreview>(await ReadFolderDiffFile(payload.scanId, payload.path, payload.maxBytes))
        } catch (err) {
          const fallbackError = err instanceof Error ? err.message.trim() : 'Preview failed'
          throw new Error(sidecarError ? `${fallbackError} Sidecar error: ${sidecarError}` : fallbackError)
        }
      }
      setPreview({
        path: previewData.path ?? node.path,
        left: previewData.left ?? '',
        right: previewData.right ?? '',
        leftState: normalizePreviewState(previewData.leftState, previewData.leftError, previewData.left),
        rightState: normalizePreviewState(previewData.rightState, previewData.rightError, previewData.right),
        leftError: cleanPreviewError(normalizePreviewState(previewData.leftState, previewData.leftError, previewData.left), previewData.leftError),
        rightError: cleanPreviewError(normalizePreviewState(previewData.rightState, previewData.rightError, previewData.right), previewData.rightError),
      })
    } catch (err) {
      setPreview({
        path: node.path,
        left: '',
        right: '',
        leftState: 'error',
        rightState: 'error',
        leftError: err instanceof Error ? err.message.trim() : 'Preview failed',
      })
    } finally {
      setPreviewLoading(false)
    }
  }

  const selectNode = (node: FolderDiffNode) => {
    setSelected(node)
    setPreview(null)
    if (!node.isDir && !node.binary) {
      void loadPreview(node)
    }
  }

  const exportReport = () => {
    if (!result) return
    downloadText('folder-diff-report.json', JSON.stringify(result, null, 2), 'application/json')
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="grid gap-2 lg:grid-cols-[1fr_1fr_150px_auto]">
        <div className="flex min-w-0 overflow-hidden rounded border border-border-2 bg-surface-2 focus-within:border-accent">
          <input
            value={left}
            onChange={(e) => setLeft(e.target.value)}
            placeholder="Left folder path, e.g. C:\\builds\\old"
            className="h-8 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-text-1 outline-none placeholder:text-text-4"
          />
          <button onClick={() => void selectFolder('left')} title="Select left folder" className="grid h-8 w-8 place-items-center border-l border-border-2 text-text-3 hover:bg-surface-3 hover:text-text-1">
            <FolderTree size={13} />
          </button>
        </div>
        <div className="flex min-w-0 overflow-hidden rounded border border-border-2 bg-surface-2 focus-within:border-accent">
          <input
            value={right}
            onChange={(e) => setRight(e.target.value)}
            placeholder="Right folder path, e.g. C:\\builds\\new"
            className="h-8 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-text-1 outline-none placeholder:text-text-4"
          />
          <button onClick={() => void selectFolder('right')} title="Select right folder" className="grid h-8 w-8 place-items-center border-l border-border-2 text-text-3 hover:bg-surface-3 hover:text-text-1">
            <FolderTree size={13} />
          </button>
        </div>
        <label className="grid grid-cols-[1fr_56px] items-center gap-2 rounded border border-border-2 bg-surface-2 px-2 text-[10px] uppercase tracking-wider text-text-4">
          Preview MB
          <input
            value={maxFileMB}
            min={1}
            max={200}
            type="number"
            onChange={(e) => setMaxFileMB(Number(e.target.value) || 20)}
            className="h-7 min-w-0 bg-transparent text-right text-xs text-text-1 outline-none"
          />
        </label>
        <button onClick={scan} disabled={loading} className="h-8 px-3 bg-accent text-white rounded text-xs font-medium disabled:opacity-50">
          {loading ? 'Scanning...' : 'Compare'}
        </button>
      </div>

      {error && <div className="rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</div>}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded border border-border-1 bg-surface-1 p-2">
            {(['all', 'left-only', 'right-only', 'modified', 'type-change', 'same'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={cn(
                  'rounded border px-2.5 py-1 text-[11px] transition-colors',
                  status === 'all' ? 'border-border-2 bg-surface-2 text-text-2' : FOLDER_DIFF_STATUS_CLASS[status],
                  filter === status && 'ring-1 ring-accent/70',
                )}
              >
                {status === 'all' ? 'All' : status === 'left-only' ? 'Solo sinistra' : status === 'right-only' ? 'Solo destra' : FOLDER_DIFF_STATUS_LABEL[status]}
                <span className="ml-1 text-text-4">{status === 'all' ? result.flat.length : result.counts[status] ?? 0}</span>
              </button>
            ))}
            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(result.flat.filter((item) => item.status !== 'same'), null, 2))} className="ml-auto rounded border border-border-2 bg-surface-2 px-2 py-1 text-[11px] text-text-2 hover:text-text-1">
              Copy changed list
            </button>
            <button onClick={exportReport} className="rounded border border-border-2 bg-surface-2 px-2 py-1 text-[11px] text-text-2 hover:text-text-1">
              Download report
            </button>
          </div>

          {result.flat.length > 0 && (result.counts.modified ?? 0) + (result.counts['left-only'] ?? 0) + (result.counts['right-only'] ?? 0) + (result.counts['type-change'] ?? 0) === 0 && (
            <div className="rounded border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">No differences found. The two folders contain the same files.</div>
          )}

          <div className="grid min-h-[560px] gap-3 xl:grid-cols-[minmax(540px,.95fr)_minmax(560px,1.05fr)]">
            <div className="min-h-0 overflow-hidden rounded border border-border-1 bg-surface-1">
              <div className="flex h-8 items-center justify-between border-b border-border-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-3">
                <span>Comparative diff</span>
                <span>{visibleEntries.length} / {result.flat.length} entries</span>
              </div>
              <div className="max-h-[560px] overflow-auto">
                <table className="min-w-[760px] w-full border-separate border-spacing-0 text-left text-[11px]">
                  <thead className="sticky top-0 z-10 bg-surface-2 text-[10px] uppercase tracking-wider text-text-4">
                    <tr>
                      <th className="border-b border-border-1 px-3 py-2 font-semibold">Relative path</th>
                      <th className="border-b border-border-1 px-2 py-2 font-semibold">Status</th>
                      <th className="border-b border-border-1 px-2 py-2 font-semibold">Left</th>
                      <th className="border-b border-border-1 px-2 py-2 font-semibold">Right</th>
                      <th className="border-b border-border-1 px-2 py-2 text-right font-semibold">Left size</th>
                      <th className="border-b border-border-1 px-2 py-2 text-right font-semibold">Right size</th>
                      <th className="border-b border-border-1 px-2 py-2 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEntries.map((entry) => {
                      const node = findFolderDiffNode(result.tree, entry.path)
                      const selectedRow = selected?.path === entry.path
                      return (
                        <tr
                          key={entry.path}
                          onClick={() => node && selectNode(node)}
                          className={cn(
                            'cursor-pointer border-b border-border-1/60 text-text-2 hover:bg-surface-2',
                            entry.status === 'left-only' && 'border-l-4 border-l-accent bg-accent/10',
                            entry.status === 'right-only' && 'border-l-4 border-l-info bg-info/10',
                            entry.status === 'modified' && 'border-l-4 border-l-warning bg-warning/10',
                            entry.status === 'type-change' && 'border-l-4 border-l-error bg-error/10',
                            selectedRow && 'bg-accent/20 text-text-1 ring-1 ring-inset ring-accent/40',
                          )}
                        >
                          <td className="border-b border-border-1/50 px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {entry.isDir ? <FolderTree size={13} className="shrink-0 text-accent-light" /> : <FileText size={13} className="shrink-0 text-text-4" />}
                              <span className="truncate font-mono">{entry.path}</span>
                            </div>
                          </td>
                          <td className="border-b border-border-1/50 px-2 py-2">
                            <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', FOLDER_DIFF_STATUS_CLASS[entry.status])}>
                              {FOLDER_DIFF_STATUS_LABEL[entry.status]}
                            </span>
                          </td>
                          <td className="border-b border-border-1/50 px-2 py-2">{entry.status !== 'right-only' ? 'Yes' : '-'}</td>
                          <td className="border-b border-border-1/50 px-2 py-2">{entry.status !== 'left-only' ? 'Yes' : '-'}</td>
                          <td className="border-b border-border-1/50 px-2 py-2 text-right font-mono text-text-3">{entry.isDir ? '-' : formatDiffBytes(entry.leftSize)}</td>
                          <td className="border-b border-border-1/50 px-2 py-2 text-right font-mono text-text-3">{entry.isDir ? '-' : formatDiffBytes(entry.rightSize)}</td>
                          <td className="border-b border-border-1/50 px-2 py-2">
                            {!entry.isDir && !entry.binary ? (
                              <button onClick={(e) => { e.stopPropagation(); if (node) selectNode(node) }} className="rounded border border-border-2 bg-surface-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1">
                                Open diff
                              </button>
                            ) : (
                              <span className="text-[10px] text-text-4">{entry.isDir ? 'Folder' : 'Binary'}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {visibleEntries.length === 0 && (
                  <div className="px-3 py-10 text-center text-xs text-text-4">No entries match this filter.</div>
                )}
              </div>
            </div>

            <div className="min-w-0 rounded border border-border-1 bg-surface-0 p-3">
              {selected ? (
                <div className="flex min-h-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-text-1">{selected.path}</span>
                    <span className={cn('rounded border px-2 py-0.5 text-[10px]', FOLDER_DIFF_STATUS_CLASS[selected.status])}>{FOLDER_DIFF_STATUS_LABEL[selected.status]}</span>
                    {selected.binary && <span className="rounded border border-border-2 bg-surface-2 px-2 py-0.5 text-[10px] text-text-4">Binary</span>}
                    <span className="ml-auto text-[10px] text-text-4">L {formatDiffBytes(selected.leftSize)} / R {formatDiffBytes(selected.rightSize)}</span>
                  </div>
                  {selected.isDir ? (
                    <div className="rounded border border-border-1 bg-surface-1 px-3 py-8 text-center text-xs text-text-4">
                      Directory selected. Pick a file to inspect text differences.
                    </div>
                  ) : selected.binary ? (
                    <div className="rounded border border-border-1 bg-surface-1 px-3 py-8 text-center text-xs text-text-4">
                      Binary preview is disabled. Size and hash are still used for comparison.
                    </div>
                  ) : previewLoading ? (
                    <div className="rounded border border-border-1 bg-surface-1 px-3 py-8 text-center text-xs text-text-4">Loading preview...</div>
                  ) : preview ? (
                    <FolderDiffPreviewPane preview={preview} />
                  ) : (
                    <button onClick={() => void loadPreview(selected)} className="self-start rounded bg-accent px-3 py-1.5 text-xs font-medium text-white">Load preview</button>
                  )}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-text-4">Run a comparison and select an entry.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
