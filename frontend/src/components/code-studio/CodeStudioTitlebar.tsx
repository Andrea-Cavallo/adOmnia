import type { CSSProperties } from 'react'
import { DRAG, WindowControls } from '@/components/layout/Titlebar'
import { useAppStore } from '@/stores/app'
import { MAIN_CODE_STUDIO_WINDOW, codeStudioWindowContext } from '@/lib/code-studio-window-api'

interface CodeStudioTitlebar {
  /** Vero se la toolbar di Code Studio fa da barra della finestra (finestra frameless e gO massimizzato o separato). */
  active: boolean
  props: { style?: CSSProperties; onDoubleClick?: (event: React.MouseEvent) => void }
}

async function toggleMaximise(): Promise<void> {
  const { WindowToggleMaximise } = await import('../../wailsjs/runtime/runtime')
  WindowToggleMaximise()
}

/** Con Code Studio massimizzato la toolbar prende il posto della barra del titolo. */
const IS_DETACHED_WINDOW = codeStudioWindowContext().windowId !== MAIN_CODE_STUDIO_WINDOW

export function useCodeStudioTitlebar(): CodeStudioTitlebar {
  // La finestra separata non ha altra barra: la toolbar resta barra del titolo anche non massimizzata.
  const active = useAppStore((state) => state.appWindowChrome && (state.codeStudioMaximized || IS_DETACHED_WINDOW))
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

export function CodeStudioWindowControls() {
  const { active } = useCodeStudioTitlebar()
  if (!active) return null
  return <><span className="ml-1 h-5 w-px shrink-0 bg-border-1" aria-hidden="true" /><WindowControls height="h-11" /></>
}
