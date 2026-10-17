import { useCodeStudioStore } from '@/stores/codeStudio'
import { currentPreview, isHtmlPath, isRunning, staticRequestForFile, type LivePreviewPlacement } from '@/lib/code-studio/livePreview'
import { selectSessionPreview, useLivePreviewStore } from '@/stores/livePreview'
import { useIdeLanguageServersStore } from '@/stores/ideLanguageServers'
import { studioToast } from '@/stores/codeStudioToast'
import type { CodeStudioCommandId } from './codeStudioCommands'

const PLACEMENT_COMMANDS: Partial<Record<CodeStudioCommandId, LivePreviewPlacement>> = {
  'preview.placeSplit': 'split', 'preview.placeTab': 'tab', 'preview.placePanel': 'panel', 'preview.placeWindow': 'window',
}

/** Il progetto ha un index.html alla radice: un file HTML aperto si serve da lì. */
function projectHasIndex(sessionId: string): boolean {
  const report = useLivePreviewStore.getState().bySession[sessionId]?.report
  return !!report?.targets.some((target) => target.relative === '.' && !!target.entryHtml)
}

/** Apre un file HTML del progetto con la Live Preview (comando contestuale dell'albero e dell'editor). */
export async function openHtmlWithLivePreview(sessionId: string, relativePath: string): Promise<void> {
  const previews = useLivePreviewStore.getState()
  if (!previews.bySession[sessionId]?.report) await previews.load(sessionId)
  await useLivePreviewStore.getState().goLive(sessionId, staticRequestForFile(relativePath, projectHasIndex(sessionId)))
}

/** Esegue i comandi della Live Preview e degli strumenti web. false se il comando non è loro. */
export function runPreviewCommand(id: CodeStudioCommandId, sessionId: string | null): boolean {
  if (!id.startsWith('preview.') && id !== 'web.installTools') return false
  if (!sessionId) return true
  const previews = useLivePreviewStore.getState()
  const placement = PLACEMENT_COMMANDS[id]
  if (placement) {
    previews.show(sessionId, placement)
    return true
  }
  switch (id) {
    case 'preview.goLive': void previews.goLive(sessionId); return true
    case 'preview.stop': void previews.stop(sessionId); return true
    case 'preview.restart': void previews.restart(sessionId); return true
    case 'preview.show': previews.show(sessionId); return true
    case 'preview.openWindow': void previews.openWindow(sessionId); return true
    case 'preview.openBrowser': void previews.openExternal(sessionId); return true
    case 'web.installTools': void useIdeLanguageServersStore.getState().confirmInstall(sessionId, 'typescript'); return true
    case 'preview.openFile': {
      const store = useCodeStudioStore.getState()
      const activeId = store.activeDocumentBySession[sessionId]
      const active = store.documents.find((item) => item.document.id === activeId)
      if (!active || !isHtmlPath(active.document.relativePath)) {
        studioToast('Open an HTML file first', 'info')
        return true
      }
      void openHtmlWithLivePreview(sessionId, active.document.relativePath)
      return true
    }
  }
  return true
}

/** Anteprima corrente della sessione (per il badge di stato). */
export function sessionPreviewRunning(sessionId: string): boolean {
  const view = selectSessionPreview(useLivePreviewStore.getState(), sessionId)
  return isRunning(currentPreview(view.previews, view.activeId))
}
