import { useState } from 'react'
import { GitCommitHorizontal, Loader2 } from 'lucide-react'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { useCodeStudioVCSStore } from '@/stores/codeStudioVcs'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'

export function CodeStudioBlameButton({ document }: { document: GoIDEEditorDocument }) {
  const { id, sessionId, relativePath, external } = document.document
  const active = useCodeStudioVCSStore(state => !!state.blame[id])
  const available = useCodeStudioVCSStore(state => !!state.status[sessionId]?.available)
  const [busy, setBusy] = useState(false)
  if (!available || external) return null
  return <button type="button" aria-label="Git blame" aria-pressed={active} disabled={busy || (!active && document.dirty)} title={document.dirty && !active ? 'Save this file before showing Git blame' : active ? 'Hide Git blame' : 'Show Git blame · author, commit and date per line'} className={`flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent ${active ? 'text-accent' : 'text-text-3'}`} onClick={() => {
    setBusy(true)
    void useCodeStudioVCSStore.getState().toggleBlame(sessionId, id, relativePath).catch(error => useCodeStudioLspStore.setState({ message: String(error) })).finally(() => setBusy(false))
  }}>{busy ? <Loader2 size={13} className="animate-spin" /> : <GitCommitHorizontal size={13} />}<span>Blame</span></button>
}
