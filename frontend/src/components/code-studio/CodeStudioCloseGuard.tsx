import { logBackgroundError } from '@/lib/code-studio/backgroundError'
import { useEffect, useState } from 'react'
import { Save, Square } from 'lucide-react'
import { confirmGoIDEAppClose, setGoIDEDirtyDocumentCount, subscribeGoIDEAppCloseRequests } from '@/lib/code-studio-api'
import {
  MAIN_CODE_STUDIO_WINDOW, confirmGoIDESessionWindowClose, setGoIDEWindowDirtyDocumentCount, subscribeGoIDEWindowCloseRequests,
} from '@/lib/code-studio-window-api'
import { goIDEDirtyDocuments, goIDEDirtyKey, useCodeStudioStore } from '@/stores/codeStudio'
import { useUpdaterStore } from '@/stores/updater'
import { CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import { CodeStudioUnsavedFileList } from './CodeStudioUnsavedFileList'

interface CloseRequest {
  dirtyDocumentCount: number
  activeRuns: boolean
}

interface CodeStudioCloseGuardProps {
  /** Finestra da proteggere: la principale chiude l'app, una separata chiude solo sé stessa. */
  windowId?: string
}

export function CodeStudioCloseGuard({ windowId = MAIN_CODE_STUDIO_WINDOW }: CodeStudioCloseGuardProps) {
  const detached = windowId !== MAIN_CODE_STUDIO_WINDOW
  const updating = useUpdaterStore(state => state.status.scheduled)
  // La chiave dei dirty è una stringa primitiva: cambia solo quando un file
  // diventa/sporca o viene salvato, non a ogni battuta. La lista si legge fresca
  // dallo store quando serve davvero (render del dialogo, salvataggio).
  const dirtyKey = useCodeStudioStore(goIDEDirtyKey)
  const saveDocument = useCodeStudioStore((state) => state.saveDocument)
  const dirtyDocuments = goIDEDirtyDocuments(useCodeStudioStore.getState())
  const [request, setRequest] = useState<CloseRequest | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const count = goIDEDirtyDocuments(useCodeStudioStore.getState()).length
    const sync = detached ? setGoIDEWindowDirtyDocumentCount(windowId, count) : setGoIDEDirtyDocumentCount(count)
    void sync.catch(logBackgroundError('close guard sync'))
  }, [detached, dirtyKey, windowId])

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
    for (const document of goIDEDirtyDocuments(useCodeStudioStore.getState())) {
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
    <CodeStudioModal
      open
      elevated
      size="sm"
      onClose={() => setRequest(null)}
      icon={dirty > 0 ? Save : Square}
      tone="warning"
      title={detached ? 'Close this window?' : 'Close adOmnia?'}
      subtitle={subtitle}
      footer={<>
        <CodeStudioButton variant="ghost" onClick={() => setRequest(null)}>Cancel</CodeStudioButton>
        {!(updating && dirty > 0) && <CodeStudioButton variant={dirty > 0 ? 'danger-ghost' : 'danger'} onClick={() => void close()}>{dirty > 0 ? 'Discard & close' : 'Stop & close'}</CodeStudioButton>}
        {dirty > 0 && <CodeStudioButton variant="primary" data-autofocus loading={saving} onClick={() => void saveAndClose()}>Save & close</CodeStudioButton>}
      </>}
    >
      <CodeStudioUnsavedFileList documents={dirtyDocuments} />
    </CodeStudioModal>
  )
}

