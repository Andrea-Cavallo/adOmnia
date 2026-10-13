import { useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { GitCompare, Loader2 } from 'lucide-react'
import { compareGoIDEPaths, type GoIDEPathComparison } from '@/lib/goide-api'
import { beforeGoStudioMount, useGoStudioEditorTheme } from './GoStudioCodeEditor'
import { GoStudioAlert, GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'

export function GoStudioCompareDialog({ sessionId, sourcePath, sourceDirectory, onClose }: { sessionId: string; sourcePath: string | null; sourceDirectory: boolean; onClose: () => void }) {
  const [target, setTarget] = useState('')
  const [result, setResult] = useState<GoIDEPathComparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const theme = useGoStudioEditorTheme()

  useEffect(() => { setTarget(''); setResult(null); setError(null) }, [sourcePath])
  const compare = async () => {
    if (!sourcePath || !target.trim()) return
    setBusy(true); setError(null); setResult(null)
    try { setResult(await compareGoIDEPaths(sessionId, sourcePath, target.trim())) }
    catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)) }
    finally { setBusy(false) }
  }

  return (
    <GoStudioModal open={!!sourcePath} onClose={onClose} title="Compare With" subtitle={sourcePath ?? ''} icon={GitCompare} size="xl" tall divided flush={!!result}
      footer={!result ? <><GoStudioButton onClick={onClose}>Cancel</GoStudioButton><GoStudioButton variant="primary" loading={busy} disabled={!target.trim()} onClick={() => void compare()}>Compare</GoStudioButton></> : <GoStudioButton onClick={onClose}>Close</GoStudioButton>}>
      {!result ? <div className="space-y-3 p-4">
        <GoStudioField label={sourceDirectory ? 'Folder to compare' : 'File to compare'} hint="Path relative to the project root. The two paths must have the same kind.">
          <input data-autofocus value={target} onChange={(event) => setTarget(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void compare() }} className="gs-input gs-mono" placeholder={sourceDirectory ? 'internal/other' : 'path/to/other.go'} />
        </GoStudioField>
        {error && <GoStudioAlert>{error}</GoStudioAlert>}
      </div> : result.kind === 'file' ? (
        <div className="h-full min-h-[28rem]"><DiffEditor original={result.leftContent ?? ''} modified={result.rightContent ?? ''} theme={theme} beforeMount={beforeGoStudioMount} options={{ automaticLayout: true, readOnly: true, minimap: { enabled: false }, fontSize: 12 }} /></div>
      ) : (
        <div className="h-full overflow-auto p-3">
          {result.differences.length === 0 ? <p className="text-text-3">The folders contain the same files and content.</p> : (
            <table className="w-full text-left text-[11px]"><thead><tr className="text-text-4"><th className="px-2 py-1">Status</th><th className="px-2 py-1">Path</th></tr></thead><tbody>{result.differences.map((difference) => <tr key={`${difference.status}:${difference.relativePath}`} className="border-t border-border-1"><td className="px-2 py-1 text-accent">{difference.status}</td><td className="px-2 py-1 font-mono text-text-2">{difference.relativePath}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
      {busy && <div className="flex items-center gap-2 p-4 text-text-3"><Loader2 size={14} className="animate-spin" /> Comparing…</div>}
    </GoStudioModal>
  )
}
