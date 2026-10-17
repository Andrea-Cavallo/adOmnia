import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { activeCodeStudioEditor } from './codeStudioEditorRegistry'
import { CODE_STUDIO_GENERATORS, runCodeStudioGenerator, type CodeStudioGenerator } from './codeStudioCodeGen'
import { runCodeStudioRefactoring } from './codeStudioRefactorings'

const ITEMS: ContextMenuItem[] = [
  { id: 'constructor', label: 'Constructor' },
  { id: 'getters', label: 'Getters' },
  { id: 'setters', label: 'Setters' },
  { id: 'interface', label: 'Extract Interface' },
  { id: 'test', label: 'Test (table-driven, gopls)', separatorBefore: true },
  { id: 'benchmark', label: 'Benchmark' },
  { id: 'fuzz', label: 'Fuzz Test' },
]

/** Code → Generate… (Alt+Insert) accanto al cursore, come negli IDE JetBrains. */
export function CodeStudioGenerateMenu() {
  const anchor = useCodeStudioLspStore((state) => state.generateMenu)
  if (!anchor) return null
  const close = () => useCodeStudioLspStore.setState({ generateMenu: null })
  const select = (id: string) => {
    close()
    const editor = activeCodeStudioEditor()
    if (!editor) return
    if (id === 'test') void runCodeStudioRefactoring(editor, 'generateTest')
    else if (id in CODE_STUDIO_GENERATORS) void runCodeStudioGenerator(editor, id as CodeStudioGenerator)
  }
  return <ContextMenu x={anchor.x} y={anchor.y} items={ITEMS} onSelect={select} onClose={close} />
}
