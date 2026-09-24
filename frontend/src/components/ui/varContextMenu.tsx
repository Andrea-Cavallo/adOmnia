import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { VarEditPopover, varEditTarget, type VarEditTarget } from '@/components/ui/VarEditPopover'
import { copyToClipboard } from '@/lib/codegen'
import { FLOW_PENDING_PREFIX } from '@/lib/flowScopeVars'
import { useKnownUiTranslation } from '@/lib/uiI18n'
import { varNameAtIndex } from '@/lib/substVars'
import { textIndexAtPoint } from '@/lib/textareaCaret'
import { bodyContextItems, runBodyEdit } from './bodyContextActions'

/**
 * Right-click menu for a `{{var}}` token — edit its value, copy the value or
 * copy the reference — shared by single-line inputs and the JSON body editor.
 */
export function useVarContextMenu(resolvedVars: Record<string, string> | undefined, onEdit: (target: VarEditTarget) => void) {
  const t = useKnownUiTranslation()
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null)
  const [flash, setFlash] = useState<{ text: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 1200)
    return () => window.clearTimeout(timer)
  }, [flash])

  const value = menu ? resolvedVars?.[menu.name] : undefined
  const pending = value?.startsWith(FLOW_PENDING_PREFIX) ?? false

  const select = (id: string) => {
    if (!menu) return
    const { name, x, y } = menu
    setMenu(null)
    if (id === 'edit') {
      onEdit(varEditTarget(name, x, y))
      return
    }
    const copyValue = id === 'copy-value'
    void copyToClipboard(copyValue ? value ?? '' : `{{${name}}}`).then((ok) => {
      setFlash({ text: t(ok ? (copyValue ? 'Value copied' : 'Reference copied') : 'Copy failed'), x, y })
    })
  }

  const varMenuElement = (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { id: 'edit', label: `${t('Edit')} {{${menu.name}}}` },
            { id: 'copy-value', label: t('Copy value'), disabled: !value || pending, disabledReason: t(pending ? 'Known after the flow runs' : 'Variable has no value') },
            { id: 'copy-ref', label: `${t('Copy')} {{${menu.name}}}` },
          ]}
          onSelect={select}
          onClose={() => setMenu(null)}
        />
      )}
      {flash && createPortal(
        <div
          role="status"
          className="pointer-events-none fixed z-[10000] rounded-md border border-border-2 bg-surface-2 px-2 py-1 text-[11px] text-text-1 shadow-lg"
          style={{ left: flash.x + 10, top: flash.y + 10 }}
        >
          {flash.text}
        </div>,
        document.body,
      )}
    </>
  )

  return { openVarMenu: (name: string, x: number, y: number) => setMenu({ name, x, y }), varMenuElement }
}

/**
 * Right-click menu for `{{var}}` tokens in a plain textarea (raw, XML, GraphQL
 * bodies). Without a token under the pointer the native menu stays available.
 *
 * When `edit` is provided the menu replaces the native browser menu entirely,
 * so the classic editing actions (copy / cut / paste / delete / select all)
 * stay available in the Wails desktop shell alongside the variable actions.
 */
export interface TextareaEditHandlers {
  getValue: () => string | undefined
  setValue: (next: string, caret: number) => void
  selectAll: () => void
}

interface TextareaMenu {
  x: number
  y: number
  body: string
  start: number
  end: number
  tokenName: string | null
}

export function useTextareaVarMenu(
  resolvedVars: Record<string, string> | undefined,
  edit?: TextareaEditHandlers,
) {
  const t = useKnownUiTranslation()
  const [varEdit, setVarEdit] = useState<VarEditTarget | null>(null)
  const { openVarMenu, varMenuElement } = useVarContextMenu(resolvedVars, setVarEdit)
  const [menu, setMenu] = useState<TextareaMenu | null>(null)
  const [clipboardError, setClipboardError] = useState('')

  useEffect(() => {
    if (!clipboardError) return
    const timer = window.setTimeout(() => setClipboardError(''), 2500)
    return () => window.clearTimeout(timer)
  }, [clipboardError])

  const onContextMenu = (event: React.MouseEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget
    const start = field.selectionStart
    const end = field.selectionEnd
    if (!edit) {
      // No editing handlers: keep the native Copy/Cut/Paste menu, even over a
      // selection, and only replace it when the pointer sits on a variable.
      if (start !== end) return
      const index = textIndexAtPoint(field, event.clientX, event.clientY)
      const name = index === null ? null : varNameAtIndex(field.value, index)
      if (!name) return
      event.preventDefault()
      openVarMenu(name, event.clientX, event.clientY)
      return
    }
    const index = textIndexAtPoint(field, event.clientX, event.clientY)
    const tokenName = start === end && index !== null ? varNameAtIndex(field.value, index) : null
    event.preventDefault()
    setClipboardError('')
    setMenu({ x: event.clientX, y: event.clientY, body: field.value, start, end, tokenName })
  }

  const select = (id: string) => {
    if (!menu || !edit) return
    const { x, y, body, start, end, tokenName } = menu
    if (id === 'edit-variable' && tokenName) {
      setMenu(null)
      setVarEdit(varEditTarget(tokenName, x, y))
      return
    }
    if (id === 'copy-variable' || id === 'copy-reference') {
      setMenu(null)
      void copyToClipboard(id === 'copy-reference' ? `{{${tokenName}}}` : resolvedVars?.[tokenName ?? ''] ?? '').then((ok) => {
        if (!ok) setClipboardError(t('Copy failed'))
      })
      return
    }
    if (id === 'select-all') {
      setMenu(null)
      edit.selectAll()
      return
    }
    setMenu(null)
    void runBodyEdit(id, { body, start, end }, navigator.clipboard, edit.getValue, edit.setValue)
      .catch(() => setClipboardError(t('Clipboard access failed. Use the keyboard shortcut.')))
  }

  const items: Parameters<typeof ContextMenu>[0]['items'] = menu
    ? [
        ...bodyContextItems(true, menu.end > menu.start).map((item) => ({ ...item, label: t(item.label) })),
        ...(menu.tokenName
          ? [
              { id: 'edit-variable', separatorBefore: true, label: `${t('Edit')} {{${menu.tokenName}}}` },
              { id: 'copy-variable', label: t('Copy value'), disabled: resolvedVars?.[menu.tokenName] === undefined },
              { id: 'copy-reference', label: `${t('Copy')} {{${menu.tokenName}}}` },
            ]
          : []),
      ]
    : []

  const element = (
    <>
      {varEdit && <VarEditPopover target={varEdit} onClose={() => setVarEdit(null)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onSelect={select} onClose={() => setMenu(null)} />}
      {varMenuElement}
      {clipboardError && createPortal(
        <div role="status" className="pointer-events-none fixed left-1/2 top-3 z-[10000] -translate-x-1/2 rounded-md border border-error/40 bg-surface-2 px-3 py-1.5 text-[11px] text-error shadow-lg">
          {clipboardError}
        </div>,
        document.body,
      )}
    </>
  )

  return { onContextMenu, varMenu: element }
}
