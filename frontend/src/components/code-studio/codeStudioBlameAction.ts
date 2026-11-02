import type { monaco } from '@/lib/monacoSetup'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioVCSStore } from '@/stores/codeStudioVcs'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { documentForModel } from './codeStudioLanguageFeatures'

/** File annotations are opt-in from the editor context menu, independently of LSP readiness. */
export function installCodeStudioBlameAction(editor: monaco.editor.IStandaloneCodeEditor): void {
  const enabled = editor.createContextKey<boolean>('adomniaCanToggleBlame', false)
  let busy = false
  const document = () => { const model = editor.getModel(); return model ? documentForModel(model) : null }
  const update = () => {
    const current = document()
    const vcs = useCodeStudioVCSStore.getState()
    enabled.set(!busy && !!current && !current.document.external && !!vcs.status[current.document.sessionId]?.available && (!current.dirty || !!vcs.blame[current.document.id]))
  }
  const action = editor.addAction({
    id: 'codeStudio.toggleGitBlame', label: 'Git Blame · Show / Hide',
    precondition: 'adomniaCanToggleBlame', contextMenuGroupId: '3_git', contextMenuOrder: 1,
    run: async () => {
      const current = document()
      if (!current || busy) return
      const { id, sessionId, relativePath, external } = current.document
      const vcs = useCodeStudioVCSStore.getState()
      if (external || !vcs.status[sessionId]?.available) return
      if (current.dirty && !vcs.blame[id]) { useCodeStudioLspStore.setState({ message: 'Save this file before showing Git blame.' }); return }
      busy = true; update()
      try { await vcs.toggleBlame(sessionId, id, relativePath) }
      catch (error) { useCodeStudioLspStore.setState({ message: error instanceof Error ? error.message : String(error) }) }
      finally { busy = false; update() }
    },
  })
  const model = editor.onDidChangeModel(update)
  const offVcs = useCodeStudioVCSStore.subscribe(update)
  const offDocuments = useCodeStudioStore.subscribe(update)
  editor.onDidDispose(() => { model.dispose(); action.dispose(); offVcs(); offDocuments(); enabled.reset() })
  update()
}
