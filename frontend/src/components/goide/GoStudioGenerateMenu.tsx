import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { GO_STUDIO_GENERATORS, runGoStudioGenerator, type GoStudioGenerator } from './goStudioCodeGen'
import { runGoStudioRefactoring } from './goStudioRefactorings'

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
export function GoStudioGenerateMenu() {
  const anchor = useGoIDELspStore((state) => state.generateMenu)
  if (!anchor) return null
  const close = () => useGoIDELspStore.setState({ generateMenu: null })
  const select = (id: string) => {
    close()
    const editor = activeGoStudioEditor()
    if (!editor) return
    if (id === 'test') void runGoStudioRefactoring(editor, 'generateTest')
    else if (id in GO_STUDIO_GENERATORS) void runGoStudioGenerator(editor, id as GoStudioGenerator)
  }
  return <ContextMenu x={anchor.x} y={anchor.y} items={ITEMS} onSelect={select} onClose={close} />
}
