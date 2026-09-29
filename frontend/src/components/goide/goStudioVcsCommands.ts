import { useAppStore } from '@/stores/app'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { syncGitStudioToSession, useGoIDEVCSStore } from '@/stores/goideVcs'
import type { GoStudioCommandId } from './goStudioCommands'

export type GoStudioVcsDialog = 'commit' | 'history' | null

/** Comandi del menu Git; false se il comando non appartiene a quest'area. */
export function runVcsCommand(id: GoStudioCommandId, sessionId: string | null, document: GoIDEEditorDocument | null, openDialog: (dialog: GoStudioVcsDialog) => void): boolean {
  switch (id) {
    case 'vcs.commit': openDialog('commit'); return true
    case 'vcs.history': openDialog('history'); return true
    case 'vcs.gitStudio':
      // Git Studio si apre sul repository del progetto, anche se prima era stato scelto a mano un altro.
      if (sessionId) syncGitStudioToSession(sessionId, true)
      useAppStore.getState().setActiveRail('gitsync')
      return true
    case 'vcs.annotate':
      if (sessionId && document) {
        if (document.dirty) useGoIDELspStore.setState({ message: 'Blame describes the saved file: save to align the annotations with your edits.' })
        void useGoIDEVCSStore.getState().toggleBlame(sessionId, document.document.id, document.document.relativePath)
          .catch((error: unknown) => useGoIDELspStore.setState({ message: error instanceof Error ? error.message : String(error) }))
      }
      return true
    default:
      return false
  }
}
