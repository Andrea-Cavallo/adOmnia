import { useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { Columns2, Loader2, Rows2 } from 'lucide-react'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import type { VCSWorkingDiff } from '../../../bindings/adomnia/internal/goide/models'
import { useGoIDEStore } from '@/stores/goide'
import { beforeGoStudioMount, useGoStudioEditorTheme } from './GoStudioCodeEditor'

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  go: 'go', mod: 'go', sum: 'plaintext', md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml', ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', css: 'css', html: 'html', xml: 'xml', sql: 'sql', sh: 'shell', proto: 'proto', toml: 'ini', dockerfile: 'dockerfile',
}

function languageOf(relativePath: string): string {
  const name = relativePath.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  return LANGUAGE_BY_EXTENSION[name.split('.').pop() ?? ''] ?? 'plaintext'
}

/**
 * Diff del file scelto nel dialog di commit: HEAD a sinistra, ciò che verrà registrato a destra.
 * Un buffer aperto e non salvato vince sul disco, perché il commit salva gli editor prima di registrare.
 */
export function GoStudioCommitDiff({ sessionId, relativePath }: { sessionId: string; relativePath: string | null }) {
  const theme = useGoStudioEditorTheme()
  const [diff, setDiff] = useState<VCSWorkingDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sideBySide, setSideBySide] = useState(true)
  const buffer = useGoIDEStore((state) => (relativePath ? state.documents.find((item) => item.document.sessionId === sessionId && item.document.relativePath === relativePath && item.dirty)?.buffer : undefined))

  useEffect(() => {
    if (!relativePath) return
    let cancelled = false
    setDiff(null)
    setError(null)
    GoIDEBindings.VCSWorkingDiff(sessionId, relativePath)
      .then((value) => { if (!cancelled) setDiff(value) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [sessionId, relativePath])

  if (!relativePath) return <div className="grid h-full place-items-center text-[12px] text-text-4">Select a file to see its changes.</div>
  const modified = buffer ?? diff?.modified ?? ''
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-1 px-3 text-[11.5px]">
        <span className="truncate font-mono text-text-2">{relativePath}</span>
        {buffer !== undefined && <span className="gs-badge h-[16px] text-[10px] text-warning" title="The editor has unsaved changes: they are saved and included when you commit">unsaved</span>}
        <span className="ml-auto text-text-4">HEAD → working copy</span>
        <button type="button" onClick={() => setSideBySide((value) => !value)} title={sideBySide ? 'Unified view' : 'Side-by-side view'} aria-label={sideBySide ? 'Unified view' : 'Side-by-side view'} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1">
          {sideBySide ? <Rows2 size={13} /> : <Columns2 size={13} />}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {error && <p className="p-3 text-[12px] text-danger">{error}</p>}
        {!error && !diff && <div className="grid h-full place-items-center"><Loader2 size={16} className="animate-spin text-text-4" aria-label="Loading diff" /></div>}
        {diff?.binary && <p className="p-3 text-[12px] text-text-3">Binary file: its content is committed as is.</p>}
        {diff?.tooLarge && <p className="p-3 text-[12px] text-text-3">The file is too large to show a diff here; open it in the editor to review it.</p>}
        {diff && !diff.binary && !diff.tooLarge && (
          <DiffEditor
            original={diff.original}
            modified={modified}
            language={languageOf(relativePath)}
            theme={theme}
            beforeMount={beforeGoStudioMount}
            originalModelPath={`inmemory://commit/head/${relativePath}`}
            modifiedModelPath={`inmemory://commit/working/${relativePath}`}
            options={{ automaticLayout: true, renderSideBySide: sideBySide, readOnly: true, originalEditable: false, minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false, renderOverviewRuler: true, hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 6 } }}
          />
        )}
      </div>
    </div>
  )
}
