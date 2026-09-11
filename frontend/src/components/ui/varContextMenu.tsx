import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { varEditTarget, type VarEditTarget } from '@/components/ui/VarEditPopover'
import { copyToClipboard } from '@/lib/codegen'
import { FLOW_PENDING_PREFIX } from '@/lib/flowScopeVars'
import { useKnownUiTranslation } from '@/lib/uiI18n'

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
