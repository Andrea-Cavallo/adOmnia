import { useCallback, useState } from 'react'
import { AlertTriangle, FileCode, GitCompare, Loader2, RefreshCw } from 'lucide-react'
import { compareRefs, getFileDiff, type ChangedFile } from '@/lib/gitsync-api'
import { DiffModal } from '@/components/response/DiffView'
import { cn } from '@/lib/utils'

interface GitCompareTabProps {
  repoPath: string
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: 'text-warning' },
  A: { label: 'A', color: 'text-success' },
  D: { label: 'D', color: 'text-error' },
  R: { label: 'R', color: 'text-accent' },
  C: { label: 'C', color: 'text-info' },
}

function extractOldContent(diff: string): string {
  if (!diff) return '(empty or binary file)'
  return diff
    .split('\n')
    .filter((l) => !l.startsWith('+++') && !l.startsWith('---') && !l.startsWith('@@') && !l.startsWith('diff') && !l.startsWith('index'))
    .filter((l) => l.startsWith(' ') || l.startsWith('-'))
    .map((l) => l.slice(1))
    .join('\n')
}

function extractNewContent(diff: string): string {
  if (!diff) return '(empty or binary file)'
  return diff
    .split('\n')
    .filter((l) => !l.startsWith('+++') && !l.startsWith('---') && !l.startsWith('@@') && !l.startsWith('diff') && !l.startsWith('index'))
    .filter((l) => l.startsWith(' ') || l.startsWith('+'))
    .map((l) => l.slice(1))
    .join('\n')
}

export function GitCompareTab({ repoPath }: GitCompareTabProps) {
  const [refA, setRefA] = useState('HEAD~1')
  const [refB, setRefB] = useState('HEAD')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [showDiff, setShowDiff] = useState(false)

  const handleCompare = useCallback(async () => {
    if (!refA.trim() || !refB.trim()) return
    setLoading(true)
    setError(null)
    setFiles([])
    setSelectedFile(null)
    setDiffText(null)
    try {
      const result = await compareRefs(repoPath, refA.trim(), refB.trim())
      setFiles(result ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [repoPath, refA, refB])

  const handleSelectFile = useCallback(async (file: ChangedFile) => {
    setSelectedFile(file)
    setDiffLoading(true)
    setDiffText(null)
    try {
      const diff = await getFileDiff(repoPath, refA.trim(), refB.trim(), file.path)
      setDiffText(diff)
      setShowDiff(true)
    } catch (err) {
      setDiffText(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiffLoading(false)
    }
  }, [repoPath, refA, refB])

  const addedCount = files.filter((f) => f.status === 'A').length
  const modifiedCount = files.filter((f) => f.status === 'M').length
  const deletedCount = files.filter((f) => f.status === 'D').length

  return (
    <div className="flex flex-col h-full">
      {/* Ref selectors */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border-1 bg-surface-1 flex-shrink-0">
        <input
          value={refA}
          onChange={(e) => setRefA(e.target.value)}
          placeholder="Base ref (branch, tag, SHA)"
          className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-[10px] font-mono text-text-1 focus:border-accent outline-none"
        />
        <GitCompare size={13} className="text-text-4 shrink-0" />
        <input
          value={refB}
          onChange={(e) => setRefB(e.target.value)}
          placeholder="Target ref (branch, tag, SHA)"
          className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-[10px] font-mono text-text-1 focus:border-accent outline-none"
        />
        <button
          onClick={handleCompare}
          disabled={loading}
          className="h-7 px-3 bg-accent text-white rounded text-[10px] font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors flex items-center gap-1.5 shrink-0"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Compare
        </button>
      </div>

      {/* Summary bar */}
      {files.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border-1 bg-surface-0 text-[10px] flex-shrink-0">
          <span className="text-text-3">{files.length} files changed</span>
          {addedCount > 0 && <span className="text-success">+{addedCount} added</span>}
          {modifiedCount > 0 && <span className="text-warning">{modifiedCount} modified</span>}
          {deletedCount > 0 && <span className="text-error">−{deletedCount} deleted</span>}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-error/10 border-b border-border-1 text-[10px] text-error flex-shrink-0">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 && !loading && !error && (
          <div className="flex items-center justify-center h-full text-[11px] text-text-4">
            Enter two refs and click Compare
          </div>
        )}
        {files.map((file) => {
          const st = STATUS_META[file.status] ?? { label: file.status, color: 'text-text-3' }
          return (
            <button
              key={file.path}
              onClick={() => handleSelectFile(file)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-left border-b border-border-1/50 hover:bg-surface-2 transition-colors',
                selectedFile?.path === file.path ? 'bg-surface-2' : '',
              )}
            >
              {diffLoading && selectedFile?.path === file.path ? (
                <Loader2 size={11} className="animate-spin text-accent shrink-0" />
              ) : (
                <FileCode size={11} className="text-text-4 shrink-0" />
              )}
              <span className={cn('font-mono font-bold text-[10px] shrink-0 w-4', st.color)}>
                {st.label}
              </span>
              <span className="text-[10px] font-mono text-text-2 truncate flex-1">{file.path}</span>
              {file.oldPath && (
                <span className="text-[9px] text-text-4 truncate max-w-[100px]">← {file.oldPath}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Diff modal */}
      {showDiff && selectedFile && diffText !== null && (
        <DiffModal
          leftLabel={`${refA} — ${selectedFile.path}`}
          rightLabel={`${refB} — ${selectedFile.path}`}
          leftBody={extractOldContent(diffText)}
          rightBody={extractNewContent(diffText)}
          onClose={() => setShowDiff(false)}
        />
      )}
    </div>
  )
}
