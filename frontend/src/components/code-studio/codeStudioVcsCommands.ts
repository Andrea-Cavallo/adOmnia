import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioVCSStore } from '@/stores/codeStudioVcs'
import { useCodeStudioStore } from '@/stores/codeStudio'
import type { CodeStudioCommandId } from './codeStudioCommands'

export type CodeStudioVcsDialog = 'commit' | 'history' | 'lineHistory' | 'conflicts' | null

/** Comandi del menu Git; false se il comando non appartiene a quest'area. */
export function runVcsCommand(id: CodeStudioCommandId, sessionId: string | null, document: GoIDEEditorDocument | null, openDialog: (dialog: CodeStudioVcsDialog) => void): boolean {
  switch (id) {
    case 'vcs.commit': openDialog('commit'); return true
    case 'vcs.history': openDialog('history'); return true
    case 'vcs.lineHistory': openDialog('lineHistory'); return true
    case 'vcs.resolveConflicts': openDialog('conflicts'); return true
    case 'vcs.gitStudio':
      if (sessionId) {
        useCodeStudioLspStore.getState().showToolWindow('git')
        useCodeStudioStore.getState().updateLayout({ bottomOpen: true })
      }
      return true
    case 'vcs.annotate':
      if (sessionId && document) {
        if (document.dirty) useCodeStudioLspStore.setState({ message: 'Blame describes the saved file: save to align the annotations with your edits.' })
        void useCodeStudioVCSStore.getState().toggleBlame(sessionId, document.document.id, document.document.relativePath)
          .catch((error: unknown) => useCodeStudioLspStore.setState({ message: error instanceof Error ? error.message : String(error) }))
      }
      return true
    default:
      return false
  }
}
