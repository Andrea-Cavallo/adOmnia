import { useEffect } from 'react'
import { FileDiff } from 'lucide-react'
import { pendingAgentFiles, useAgentReviewStore } from '@/stores/codeStudioAgentReview'

/** Sopra il composer della chat: quanti file l'agente ha cambiato e non sono ancora stati rivisti. */
export function CodeStudioAgentReviewBar({ root, busy }: { root: string; busy: boolean }) {
  const files = useAgentReviewStore((state) => pendingAgentFiles(state, root))
  const notice = useAgentReviewStore((state) => state.reviews[root]?.notice)

  // A fine turno il backend emette agentReview.changed; il primo load attiva anche l'ascolto.
  useEffect(() => { void useAgentReviewStore.getState().load(root) }, [root, busy])

  if (notice && files.length === 0) return <p role="status" className="milk-review-bar text-warning">{notice}</p>
  if (files.length === 0) return null
  const label = `${files.length} file${files.length === 1 ? '' : 's'} changed by the agent`
  return (
    <div className="milk-review-bar" role="status">
      <FileDiff size={13} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate" title={files.map((file) => file.path).join('\n')}>{label}</span>
      <button type="button" onClick={() => useAgentReviewStore.getState().open(root)} className="gs-btn gs-btn-primary gs-btn-sm">Review</button>
    </div>
  )
}
