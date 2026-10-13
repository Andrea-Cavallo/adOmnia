import { useEffect, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { createGoIDEGist } from '@/lib/goide-api'
import { confirm } from '@/lib/confirmDialog'
import { GoStudioAlert, GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'

export function GoStudioGistDialog({ sessionId, relativePath, onClose }: { sessionId: string; relativePath: string | null; onClose: () => void }) {
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'secret' | 'public'>('secret')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { setDescription(''); setVisibility('secret'); setError(null); setUrl(null) }, [relativePath])

  const publish = async () => {
    if (!relativePath) return
    const accepted = await confirm({ title: `Create ${visibility} GitHub Gist?`, message: `${relativePath} will be uploaded to GitHub through the authenticated gh CLI.`, confirmLabel: 'Upload' })
    if (!accepted) return
    setBusy(true); setError(null)
    try { setUrl(await createGoIDEGist(sessionId, relativePath, description, visibility === 'public')) }
    catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)) }
    finally { setBusy(false) }
  }

  return (
    <GoStudioModal open={!!relativePath} onClose={onClose} title="Create GitHub Gist" subtitle={relativePath ?? ''} icon={GitBranch} size="md"
      footer={<><GoStudioButton onClick={onClose}>{url ? 'Close' : 'Cancel'}</GoStudioButton>{!url && <GoStudioButton variant="primary" loading={busy} onClick={() => void publish()}>Create Gist</GoStudioButton>}</>}>
      <div className="space-y-3 p-4">
        {!url && <>
          <GoStudioField label="Description" hint="Optional. GitHub CLI must be installed and authenticated."><input data-autofocus value={description} onChange={(event) => setDescription(event.target.value)} className="gs-input" placeholder="What this file demonstrates" /></GoStudioField>
          <GoStudioField label="Visibility"><select value={visibility} onChange={(event) => setVisibility(event.target.value as 'secret' | 'public')} className="gs-input"><option value="secret">Secret (unlisted)</option><option value="public">Public</option></select></GoStudioField>
        </>}
        {error && <GoStudioAlert>{error}</GoStudioAlert>}
        {url && <GoStudioAlert tone="success">Gist created: <a href={url} target="_blank" rel="noreferrer" className="underline">{url}</a></GoStudioAlert>}
      </div>
    </GoStudioModal>
  )
}
