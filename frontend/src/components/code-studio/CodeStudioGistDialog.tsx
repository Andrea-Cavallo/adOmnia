import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { createGoIDEGist } from '@/lib/code-studio-api'
import { confirm } from '@/lib/confirmDialog'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField, CodeStudioModal } from './CodeStudioModal'

export function CodeStudioGistDialog({ sessionId, relativePath, onClose }: { sessionId: string; relativePath: string | null; onClose: () => void }) {
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'secret' | 'public'>('secret')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [prevPath, setPrevPath] = useState(relativePath)
  if (prevPath !== relativePath) {
    setPrevPath(relativePath)
    setDescription(''); setVisibility('secret'); setError(null); setUrl(null)
  }

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
    <CodeStudioModal open={!!relativePath} onClose={onClose} title="Create GitHub Gist" subtitle={relativePath ?? ''} icon={GitBranch} size="md"
      footer={<><CodeStudioButton onClick={onClose}>{url ? 'Close' : 'Cancel'}</CodeStudioButton>{!url && <CodeStudioButton variant="primary" loading={busy} onClick={() => void publish()}>Create Gist</CodeStudioButton>}</>}>
      <div className="space-y-3 p-4">
        {!url && <>
          <CodeStudioField label="Description" hint="Optional. GitHub CLI must be installed and authenticated."><input data-autofocus value={description} onChange={(event) => setDescription(event.target.value)} className="gs-input" placeholder="What this file demonstrates" /></CodeStudioField>
          <CodeStudioField label="Visibility"><select value={visibility} onChange={(event) => setVisibility(event.target.value as 'secret' | 'public')} className="gs-input"><option value="secret">Secret (unlisted)</option><option value="public">Public</option></select></CodeStudioField>
        </>}
        {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
        {url && <CodeStudioAlert tone="success">Gist created: <a href={url} target="_blank" rel="noreferrer" className="underline">{url}</a></CodeStudioAlert>}
      </div>
    </CodeStudioModal>
  )
}
