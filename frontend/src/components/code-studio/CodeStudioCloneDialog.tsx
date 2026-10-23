import { useState } from 'react'
import { AlertCircle, FolderOpen, GitBranch } from 'lucide-react'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import { chooseGoIDEProjectFolder } from '@/lib/code-studio-api'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField, CodeStudioModal } from './CodeStudioModal'
import { useCodeStudioStore } from '@/stores/codeStudio'

interface CodeStudioCloneDialogProps {
  open: boolean
  onClose: () => void
}

const URL_HINT = /^(?:(?:https?|ssh|git):\/\/\S+|[\w.-]+@[\w.-]+:\S+)$/

/** Toglie le barre finali dalla coda: la regex `[\\/]+$` ha backtracking non lineare sugli URL lunghi. */
const withoutTrailingSeparators = (value: string): string => {
  let end = value.length
  while (end > 0 && (value[end - 1] === '/' || value[end - 1] === '\\')) end -= 1
  return value.slice(0, end)
}

/** File → Clone Repository…: git clone in una cartella scelta, poi il progetto si apre (non autorizzato). */
export function CodeStudioCloneDialog({ open, onClose }: CodeStudioCloneDialogProps) {
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) { setWasOpen(open); if (open) setError(null) }
  if (!open) return null

  const name = withoutTrailingSeparators(url.trim()).replace(/\.git$/, '').split(/[/:]/).pop() ?? ''
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
      await useCodeStudioStore.getState().openProject(destination)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const guardedClose = () => { if (!busy) onClose() }
  return (
    <CodeStudioModal
      open={open}
      onClose={guardedClose}
      size="md"
      icon={GitBranch}
      title="Clone repository"
      subtitle="Uses the Git and credentials already set up on this machine."
      footerStart="The project opens untrusted: nothing runs until you trust it."
      footer={<>
        <CodeStudioButton variant="ghost" onClick={guardedClose} disabled={busy}>Cancel</CodeStudioButton>
        <CodeStudioButton variant="primary" type="submit" form="code-studio-clone-form" loading={busy} disabled={!valid}>{busy ? 'Cloning…' : 'Clone'}</CodeStudioButton>
      </>}
    >
      <form id="code-studio-clone-form" className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (valid && !busy) void clone() }}>
        <CodeStudioField label="Repository URL">
          <input data-autofocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo.git · git@host:owner/repo.git" className="gs-input gs-mono" />
        </CodeStudioField>
        <CodeStudioField label="Parent folder" hint={valid && name ? <span className="gs-mono">→ {withoutTrailingSeparators(parent)}{parent.includes('\\') ? '\\' : '/'}{name}</span> : undefined}>
          <div className="flex gap-2">
            <input value={parent} onChange={(event) => setParent(event.target.value)} placeholder="C:\Users\you\Workspaces" className="gs-input gs-mono flex-1" />
            <CodeStudioButton variant="secondary" icon={FolderOpen} onClick={() => void browse()}>Browse…</CodeStudioButton>
          </div>
        </CodeStudioField>
        {error && <CodeStudioAlert icon={AlertCircle}><span className="whitespace-pre-wrap break-words">{error}</span></CodeStudioAlert>}
      </form>
    </CodeStudioModal>
  )
}
