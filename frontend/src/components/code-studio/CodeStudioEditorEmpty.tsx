import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { selectSessionPreview, useLivePreviewStore } from '@/stores/livePreview'
import { CodeStudioEditorTabs } from './CodeStudioEditorTabs'
import { CodeStudioLivePreview } from './CodeStudioLivePreview'
import { CodeStudioPreviewSplit } from './CodeStudioPreviewSplit'

/**
 * The editor area with no active document. It does not import Monaco: Code Studio opens without the
 * editor bundle and loads it with the first file (see `CodeStudioWorkspace`).
 */
export function CodeStudioEditorEmpty({ documents, onRequestClose }: { documents: GoIDEEditorDocument[]; onRequestClose: (documents: GoIDEEditorDocument[]) => void }) {
  const sessions = useCodeStudioStore((state) => state.sessions)
  const previewSessionId = useCodeStudioStore((state) => state.activeSessionId) ?? undefined
  const livePreview = useLivePreviewStore((state) => selectSessionPreview(state, previewSessionId))
  const previewSession = previewSessionId ? sessions.find((item) => item.id === previewSessionId) : undefined
  const previewInSplit = !!previewSession && livePreview.visible && livePreview.placement === 'split'
  const previewInTab = !!previewSession && livePreview.visible && livePreview.placement === 'tab'
  const empty = (
    <section aria-label="Editor" className="flex min-h-0 flex-1 items-center justify-center">
      <div className="text-center text-[11px] text-text-4">
        <p className="font-medium text-text-3">Open a file from Project</p>
        <p className="mt-1">Go to File: Ctrl/Cmd+P · Symbol: Ctrl/Cmd+T · Find in Files: Ctrl/Cmd+Shift+F</p>
      </div>
    </section>
  )
  if (previewInTab && previewSession) {
    return (
      <section aria-label="Editor" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <CodeStudioEditorTabs
          documents={documents} activeId="" onRequestClose={onRequestClose}
          previewTab={{ active: livePreview.tabActive, label: 'Live Preview', onSelect: () => useLivePreviewStore.getState().setTabActive(previewSession.id, true), onClose: () => useLivePreviewStore.getState().hide(previewSession.id) }}
          onSelectDocument={() => useLivePreviewStore.getState().setTabActive(previewSession.id, false)}
        />
        <div className="relative flex min-h-0 min-w-0 flex-1">{livePreview.tabActive ? <CodeStudioLivePreview session={previewSession} embedded /> : empty}</div>
      </section>
    )
  }
  return <CodeStudioPreviewSplit session={previewSession} open={previewInSplit} editor={empty} />
}
