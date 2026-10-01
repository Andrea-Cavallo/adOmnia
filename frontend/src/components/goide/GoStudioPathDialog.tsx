import { useEffect, useRef, useState } from 'react'
import { Copy, FileCode2, FilePlus, FolderPlus, Pencil, type LucideIcon } from 'lucide-react'
import { GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'
import { baseName, duplicateName, runPathAction, type GoStudioPathAction } from './goStudioFileActions'

export interface GoStudioPathRequest {
  action: GoStudioPathAction
  /** Cartella di destinazione per new*, elemento sorgente per rename/duplicate. */
  target: string
}

const TITLES: Record<GoStudioPathAction, string> = {
  newGoFile: 'New Go File', newFile: 'New File', newFolder: 'New Folder', rename: 'Rename', duplicate: 'Duplicate',
}
const ICONS: Record<GoStudioPathAction, LucideIcon> = {
  newGoFile: FileCode2, newFile: FilePlus, newFolder: FolderPlus, rename: Pencil, duplicate: Copy,
}
const HINTS: Record<GoStudioPathAction, string> = {
  newGoFile: 'The .go extension and the package clause are added for you. Use / for subfolders.',
  newFile: 'Use / to create it inside new subfolders.',
  newFolder: 'Nested folders like internal/store are created in one step.',
  rename: 'Type a path with / to move it to another folder. Open tabs are reopened at the new path.',
  duplicate: 'Folders are copied with their contents.',
}

function initialName(request: GoStudioPathRequest): string {
  if (request.action === 'rename') return baseName(request.target)
  if (request.action === 'duplicate') return duplicateName(baseName(request.target))
  return ''
}

export function GoStudioPathDialog({ sessionId, request, onClose }: { sessionId: string; request: GoStudioPathRequest | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!request) return
    const value = initialName(request)
    setName(value)
    // Come JetBrains: nel rename è selezionato il nome senza estensione.
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      const dot = value.lastIndexOf('.')
      input.setSelectionRange(0, dot > 0 ? dot : value.length)
    })
  }, [request])

  if (!request) return null
  const location = request.action === 'rename' || request.action === 'duplicate' ? request.target : `${request.target || '(project root)'}/`
  const submit = async () => {
    setBusy(true)
    const ok = await runPathAction(sessionId, request.action, request.target, name)
    setBusy(false)
    if (ok) onClose()
  }

  const verb = request.action === 'rename' ? 'Rename' : request.action === 'duplicate' ? 'Duplicate' : 'Create'
  return (
    <GoStudioModal
      open
      onClose={onClose}
      size="sm"
      icon={ICONS[request.action]}
      title={TITLES[request.action]}
      subtitle={<span className="gs-mono block truncate text-[11.5px]" title={location}>{location}</span>}
      footer={<>
        <GoStudioButton variant="ghost" onClick={onClose}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" type="submit" form="go-studio-path-form" loading={busy} disabled={!name.trim()}>{verb}</GoStudioButton>
      </>}
    >
      <form id="go-studio-path-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <GoStudioField label="Name" hint={HINTS[request.action]}>
          <input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} className="gs-input gs-mono" />
        </GoStudioField>
      </form>
    </GoStudioModal>
  )
}
