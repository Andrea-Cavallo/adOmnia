import { useState } from 'react'
import { AppWindow, ArrowDownToLine, Loader2 } from 'lucide-react'
import type { RailItem } from '@/lib/navigation'
import { closePanelWindow, focusPanelWindow } from '@/lib/panel-windows-api'
import { useUiTranslation } from '@/lib/uiI18n'
import { usePanelLabel } from './panelLabel'

interface DetachedPanelPlaceholderProps {
  rail: RailItem
  titleKey?: string
}

/** Shown in the main window while the module lives in its own window: one place edits it. */
export function DetachedPanelPlaceholder({ rail, titleKey }: DetachedPanelPlaceholderProps) {
  const tr = useUiTranslation()
  const label = usePanelLabel(rail, titleKey)
  const [returning, setReturning] = useState(false)

  const bringBack = async () => {
    setReturning(true)
    try {
      await closePanelWindow(rail)
    } finally {
      setReturning(false)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-surface-0 p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border-1 bg-surface-1 px-8 py-7 text-center shadow-sm">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-accent/12 text-accent"><AppWindow size={20} /></span>
        <div>
          <p className="text-[13px] font-semibold text-text-1">{tr('{name} is open in its own window', { name: label })}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-text-3">{tr('It is edited there, so nothing is overwritten. Bring it back here when you are done, or simply close that window.')}</p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <button type="button" onClick={() => void focusPanelWindow(rail)} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent-hover">
            <AppWindow size={13} />{tr('Show window')}
          </button>
          <button type="button" onClick={() => void bringBack()} disabled={returning} className="flex h-8 items-center gap-1.5 rounded-md border border-border-1 px-3 text-[12px] text-text-2 hover:border-accent hover:text-text-1 disabled:opacity-50">
            {returning ? <Loader2 size={13} className="animate-spin" /> : <ArrowDownToLine size={13} />}{tr('Bring back here')}
          </button>
        </div>
      </div>
    </div>
  )
}
