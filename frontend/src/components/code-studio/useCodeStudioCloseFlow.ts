import { useState } from 'react'
import type { GoIDESession } from '@/lib/code-studio-api'
import { confirm } from '@/lib/confirmDialog'
import { dirtyGoIDEDocuments, useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'

const STOP_POLL_ATTEMPTS = 30
const STOP_POLL_INTERVAL_MS = 100

/** Chiusura in attesa di Save/Discard: `documents` sono i dirty da mostrare, `targets` tutto ciò che verrà chiuso. */
export type CodeStudioPendingClose =
  | { kind: 'documents'; documents: GoIDEEditorDocument[]; targets: GoIDEEditorDocument[] }
  | { kind: 'session'; documents: GoIDEEditorDocument[] }

/** Flusso unico di chiusura di tab e sessioni: nessun buffer dirty o processo attivo viene perso senza conferma. */
export function useCodeStudioCloseFlow(session: GoIDESession | null) {
  const [pending, setPending] = useState<CodeStudioPendingClose | null>(null)

  const closeAll = async (documents: GoIDEEditorDocument[]) => {
    for (const document of documents) await useCodeStudioStore.getState().closeDocument(document.document.id)
  }

  const requestCloseDocuments = (documents: GoIDEEditorDocument[]) => {
    const dirty = documents.filter((document) => document.dirty)
    if (dirty.length) return setPending({ kind: 'documents', documents: dirty, targets: documents })
    void closeAll(documents)
  }

  const stopRunsAndCloseSession = async () => {
    if (!session) return false
    const store = useCodeStudioStore.getState()
    const running = store.executions.filter((execution) => execution.sessionId === session.id && execution.status === 'running')
    if (running.length) {
      const approved = await confirm({ title: 'Stop active runs?', message: `Closing ${session.project.name} will stop ${running.length} active process tree${running.length === 1 ? '' : 's'}.`, confirmLabel: 'Stop and close', variant: 'danger' })
      if (!approved) return false
      await Promise.all(running.map((execution) => store.stopRun(execution.id)))
      for (let attempt = 0; attempt < STOP_POLL_ATTEMPTS; attempt += 1) {
        if (!await store.hasActiveRuns(session.id)) break
        await new Promise((resolve) => window.setTimeout(resolve, STOP_POLL_INTERVAL_MS))
      }
    }
    return useCodeStudioStore.getState().closeActiveSession(true)
  }

  const requestCloseSession = async () => {
    if (!session) return
    const dirty = dirtyGoIDEDocuments(useCodeStudioStore.getState(), session.id)
    if (dirty.length) return setPending({ kind: 'session', documents: dirty })
    await stopRunsAndCloseSession()
  }

  const settle = async (save: boolean) => {
    if (!pending) return
    if (save) {
      for (const document of pending.documents) if (!await useCodeStudioStore.getState().saveDocument(document.document.id)) return
    }
    setPending(null)
    if (pending.kind === 'documents') await closeAll(pending.targets)
    else await stopRunsAndCloseSession()
  }

  return { pending, requestCloseDocuments, requestCloseSession, settle, cancel: () => setPending(null) }
}
