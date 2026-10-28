import { monaco } from '@/lib/monacoSetup'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { symbolOrigin } from '@/lib/code-studio/symbolOrigin'
import { documentForModel } from './codeStudioLanguageFeatures'

export function installSymbolOriginCopy(
  editor: monaco.editor.IStandaloneCodeEditor,
): void {
  const origin = () => {
    const model = editor.getModel()
    const document = model ? documentForModel(model) : null
    const project = useCodeStudioStore
      .getState()
      .sessions.find(
        (session) => session.id === document?.document.sessionId,
      )?.project
    return model && document && project
      ? symbolOrigin(
          project,
          document.document.path,
          document.document.language,
          model.getValue(),
        )
      : null
  }
  const copy = async () => {
    const value = origin()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      useCodeStudioLspStore.setState({ message: `Copied origin: ${value}` })
    } catch (error) {
      useCodeStudioLspStore.setState({
        message: `Could not copy origin: ${String(error)}`,
      })
    }
  }
  const action = editor.addAction({
    id: 'codeStudio.copySymbolOrigin',
    label: 'Copy Symbol Origin',
    contextMenuGroupId: 'navigation',
    run: copy,
  })
  const element = editor.getDomNode()
  const context = (event: MouseEvent) => {
    const link = (event.target as Element).closest('.codelens-decoration a')
    if (!link || link.textContent !== origin()) return
    event.preventDefault()
    event.stopPropagation()
    void copy()
  }
  element?.addEventListener('contextmenu', context, true)
  editor.onDidDispose(() => {
    action.dispose()
    element?.removeEventListener('contextmenu', context, true)
  })
}
