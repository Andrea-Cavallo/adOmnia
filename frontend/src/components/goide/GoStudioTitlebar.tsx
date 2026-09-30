import type { CSSProperties } from 'react'
import { DRAG, WindowControls } from '@/components/layout/Titlebar'
import { useAppStore } from '@/stores/app'

interface GoStudioTitlebar {
  /** Vero se la toolbar di gO Studio fa da barra della finestra (finestra frameless e gO massimizzato). */
  active: boolean
  props: { style?: CSSProperties; onDoubleClick?: (event: React.MouseEvent) => void }
}

async function toggleMaximise(): Promise<void> {
  const { WindowToggleMaximise } = await import('../../wailsjs/runtime/runtime')
  WindowToggleMaximise()
}

/** Come JetBrains: con gO Studio massimizzato la toolbar prende il posto della barra del titolo. */
export function useGoStudioTitlebar(): GoStudioTitlebar {
  const active = useAppStore((state) => state.appWindowChrome && state.goStudioMaximized)
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
