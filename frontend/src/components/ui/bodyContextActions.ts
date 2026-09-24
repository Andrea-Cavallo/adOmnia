import type { ContextMenuItem } from './ContextMenu'

export function bodyContextItems(editable: boolean, selected: boolean): (ContextMenuItem & { label: 'Copy' | 'Copy body' | 'Cut' | 'Paste' | 'Delete' | 'Select all' })[] {
  return [
    { id: 'copy', label: 'Copy', disabled: !selected },
    { id: 'copy-body', label: 'Copy body' },
    ...(editable ? [
      { id: 'cut', label: 'Cut' as const, disabled: !selected },
      { id: 'paste', label: 'Paste' as const },
      { id: 'delete', label: 'Delete' as const, disabled: !selected },
    ] : []),
    { id: 'select-all', label: 'Select all', separatorBefore: true },
  ]
}

export type BodySelection = { body: string; start: number; end: number }

/** Capture the range before the menu takes focus; never edit a changed document. */
export async function runBodyEdit(
  action: string,
  selection: BodySelection,
  clipboard: Pick<Clipboard, 'readText' | 'writeText'>,
  current: () => string | undefined,
  replace: (value: string, caret: number) => void,
) {
  const { body, start, end } = selection
  if (action === 'copy-body') { await clipboard.writeText(body); return }
  if (action === 'copy' || action === 'cut') await clipboard.writeText(body.slice(start, end))
  if (!['cut', 'paste', 'delete'].includes(action)) return
  const inserted = action === 'paste' ? await clipboard.readText() : ''
  if (current() !== body) return
  replace(body.slice(0, start) + inserted + body.slice(end), start + inserted.length)
}
