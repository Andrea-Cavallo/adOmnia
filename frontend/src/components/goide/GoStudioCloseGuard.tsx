import { useEffect, useState } from 'react'
import { Save, Square } from 'lucide-react'
import { confirmGoIDEAppClose, setGoIDEDirtyDocumentCount, subscribeGoIDEAppCloseRequests } from '@/lib/goide-api'
import {
  MAIN_GO_STUDIO_WINDOW, confirmGoIDESessionWindowClose, setGoIDEWindowDirtyDocumentCount, subscribeGoIDEWindowCloseRequests,
} from '@/lib/goide-window-api'
import { useGoIDEStore } from '@/stores/goide'
import { useUpdaterStore } from '@/stores/updater'
import { GoStudioButton, GoStudioModal } from './GoStudioModal'
import { GoStudioUnsavedFileList } from './GoStudioUnsavedFileList'

interface CloseRequest {
  dirtyDocumentCount: number
  activeRuns: boolean
}

interface GoStudioCloseGuardProps {
  /** Finestra da proteggere: la principale chiude l'app, una separata chiude solo sé stessa. */
  windowId?: string
}

export function GoStudioCloseGuard({ windowId = MAIN_GO_STUDIO_WINDOW }: GoStudioCloseGuardProps) {
  const detached = windowId !== MAIN_GO_STUDIO_WINDOW
  const updating = useUpdaterStore(state => state.status.scheduled)
  const documents = useGoIDEStore((state) => state.documents)
  const saveDocument = useGoIDEStore((state) => state.saveDocument)
  const dirtyDocuments = documents.filter((document) => document.dirty)
  const [request, setRequest] = useState<CloseRequest | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const sync = detached ? setGoIDEWindowDirtyDocumentCount(windowId, dirtyDocuments.length) : setGoIDEDirtyDocumentCount(dirtyDocuments.length)
    void sync.catch(() => undefined)
  }, [detached, dirtyDocuments.length, windowId])

  useEffect(() => {
    if (!detached) return subscribeGoIDEAppCloseRequests((next) => setRequest({ dirtyDocumentCount: next.dirtyDocumentCount, activeRuns: next.activeRuns }))
    // L'evento arriva a tutte le finestre: risponde solo quella che si sta chiudendo.
    return subscribeGoIDEWindowCloseRequests((next) => {
      if (next.windowId === windowId) setRequest({ dirtyDocumentCount: next.dirtyDocumentCount, activeRuns: false })
    })
  }, [detached, windowId])

  if (!request) return null

  const close = async () => {
    setRequest(null)
    await (detached ? confirmGoIDESessionWindowClose(windowId) : confirmGoIDEAppClose())
  }
  const saveAndClose = async () => {
    setSaving(true)
    for (const document of dirtyDocuments) {
      if (!await saveDocument(document.document.id)) {
        setSaving(false)
        return
      }
    }
    setSaving(false)
    await close()
  }

  const dirty = dirtyDocuments.length
  const subtitle = [
    dirty > 0 ? `${dirty} file${dirty === 1 ? ' has' : 's have'} unsaved changes.` : '',
    request.activeRuns ? 'Running Go processes and their children will be stopped.' : '',
    detached ? 'The project moves back to the main window.' : '',
  ].filter(Boolean).join(' ')

  return (
    <GoStudioModal
      open
      elevated
      size="sm"
      onClose={() => setRequest(null)}
      icon={dirty > 0 ? Save : Square}
      tone="warning"
      title={detached ? 'Close this window?' : 'Close adOmnia?'}
      subtitle={subtitle}
      footer={<>
        <GoStudioButton variant="ghost" onClick={() => setRequest(null)}>Cancel</GoStudioButton>
        {!(updating && dirty > 0) && <GoStudioButton variant={dirty > 0 ? 'danger-ghost' : 'danger'} onClick={() => void close()}>{dirty > 0 ? 'Discard & close' : 'Stop & close'}</GoStudioButton>}
        {dirty > 0 && <GoStudioButton variant="primary" data-autofocus loading={saving} onClick={() => void saveAndClose()}>Save & close</GoStudioButton>}
      </>}
    >
      <GoStudioUnsavedFileList documents={dirtyDocuments} />
    </GoStudioModal>
  )
}

