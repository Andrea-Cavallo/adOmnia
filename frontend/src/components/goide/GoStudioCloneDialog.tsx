import { useEffect, useState } from 'react'
import { AlertCircle, FolderOpen, GitBranch } from 'lucide-react'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import { chooseGoIDEProjectFolder } from '@/lib/goide-api'
import { GoStudioAlert, GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'
import { useGoIDEStore } from '@/stores/goide'

interface GoStudioCloneDialogProps {
  open: boolean
  onClose: () => void
}

const URL_HINT = /^(?:(?:https?|ssh|git):\/\/\S+|[\w.-]+@[\w.-]+:\S+)$/

/** File → Clone Repository…: git clone in una cartella scelta, poi il progetto si apre (non autorizzato). */
export function GoStudioCloneDialog({ open, onClose }: GoStudioCloneDialogProps) {
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) setError(null) }, [open])
  if (!open) return null

  const name = url.trim().replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() ?? ''
  const valid = URL_HINT.test(url.trim()) && parent.trim() !== ''
  const browse = async () => {
    const folder = await chooseGoIDEProjectFolder().catch(() => '')
    if (folder) setParent(folder)
  }
  const clone = async () => {
    setBusy(true)
    setError(null)
    try {
      const destination = await GoIDEBindings.CloneRepository(url.trim(), parent.trim())
      onClose()
      await useGoIDEStore.getState().openProject(destination)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const guardedClose = () => { if (!busy) onClose() }
  return (
    <GoStudioModal
      open={open}
      onClose={guardedClose}
      size="md"
      icon={GitBranch}
      title="Clone repository"
      subtitle="Uses the Git and credentials already set up on this machine."
      footerStart="The project opens untrusted: nothing runs until you trust it."
      footer={<>
        <GoStudioButton variant="ghost" onClick={guardedClose} disabled={busy}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" type="submit" form="go-studio-clone-form" loading={busy} disabled={!valid}>{busy ? 'Cloning…' : 'Clone'}</GoStudioButton>
      </>}
    >
      <form id="go-studio-clone-form" className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (valid && !busy) void clone() }}>
        <GoStudioField label="Repository URL">
          <input data-autofocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo.git · git@host:owner/repo.git" className="gs-input gs-mono" />
        </GoStudioField>
        <GoStudioField label="Parent folder" hint={valid && name ? <span className="gs-mono">→ {parent.replace(/[\\/]+$/, '')}{parent.includes('\\') ? '\\' : '/'}{name}</span> : undefined}>
          <div className="flex gap-2">
            <input value={parent} onChange={(event) => setParent(event.target.value)} placeholder="C:\Users\you\Workspaces" className="gs-input gs-mono flex-1" />
            <GoStudioButton variant="secondary" icon={FolderOpen} onClick={() => void browse()}>Browse…</GoStudioButton>
          </div>
        </GoStudioField>
        {error && <GoStudioAlert icon={AlertCircle}><span className="whitespace-pre-wrap break-words">{error}</span></GoStudioAlert>}
      </form>
    </GoStudioModal>
  )
}
