import type { CSSProperties } from 'react'
import { DRAG, WindowControls } from '@/components/layout/Titlebar'
import { useAppStore } from '@/stores/app'
import { MAIN_GO_STUDIO_WINDOW, goStudioWindowContext } from '@/lib/goide-window-api'

interface GoStudioTitlebar {
  /** Vero se la toolbar di gO Studio fa da barra della finestra (finestra frameless e gO massimizzato o separato). */
  active: boolean
  props: { style?: CSSProperties; onDoubleClick?: (event: React.MouseEvent) => void }
}

async function toggleMaximise(): Promise<void> {
  const { WindowToggleMaximise } = await import('../../wailsjs/runtime/runtime')
  WindowToggleMaximise()
}

/** Come JetBrains: con gO Studio massimizzato la toolbar prende il posto della barra del titolo. */
const IS_DETACHED_WINDOW = goStudioWindowContext().windowId !== MAIN_GO_STUDIO_WINDOW

export function useGoStudioTitlebar(): GoStudioTitlebar {
  // La finestra separata non ha altra barra: la toolbar resta barra del titolo anche non massimizzata.
  const active = useAppStore((state) => state.appWindowChrome && (state.goStudioMaximized || IS_DETACHED_WINDOW))
  if (!active) return { active, props: {} }
  return {
    active,
    props: {
      style: DRAG,
      // Doppio clic sugli spazi vuoti: ingrandisci / ripristina, come la barra di sistema.
      onDoubleClick: (event) => { if (event.target === event.currentTarget) void toggleMaximise() },
    },
  }
}

export function GoStudioWindowControls() {
  const { active } = useGoStudioTitlebar()
  if (!active) return null
  return <><span className="ml-1 h-5 w-px shrink-0 bg-border-1" aria-hidden="true" /><WindowControls height="h-12" /></>
}
