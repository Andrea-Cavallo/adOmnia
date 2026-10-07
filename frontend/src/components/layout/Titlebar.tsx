import { useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { useUiTranslation } from '@/lib/uiI18n'
import { useAppStore } from '@/stores/app'
import { Window } from '@wailsio/runtime'

/** Riduci / ingrandisci / chiudi della finestra frameless: usati dalla barra di adOmnia e dalla toolbar di gO Studio. */
export function WindowControls({ height = 'h-8' }: { height?: string }) {
  const tr = useUiTranslation()
  const port = useServerPort()

  const onMinimise = useCallback(async () => {
    // Optionally lock the vault before the window is minimised.
    if (useSettingsStore.getState().settings.vault.lockVaultOnMinimize) {
      const url = serverUrl(port, '/vault/lock')
      if (url) {
        try { await sidecarFetch(url, { method: 'POST' }) } catch { /* never block minimise */ }
      }
    }
    const { WindowMinimise } = await import('../../wailsjs/runtime/runtime')
    WindowMinimise()
  }, [port])

  const onMaximise = useCallback(async () => {
    const { WindowToggleMaximise } = await import('../../wailsjs/runtime/runtime')
    WindowToggleMaximise()
  }, [])

  const onClose = useCallback(async () => {
    await Window.Close()
  }, [])

  const button = `grid ${height} w-11 place-items-center text-text-3 transition-colors`
  return (
    <div data-window-controls className={`flex ${height} shrink-0 items-stretch`} style={NO_DRAG}>
      <button type="button" onClick={onMinimise} aria-label={tr('Minimize window')} className={`${button} hover:bg-surface-3 hover:text-text-1`} style={NO_DRAG}><MinusIcon /></button>
      <button type="button" onClick={onMaximise} aria-label={tr('Maximize or restore window')} className={`${button} hover:bg-surface-3 hover:text-text-1`} style={NO_DRAG}><MaxIcon /></button>
      <button type="button" onClick={onClose} aria-label={tr('Close window')} className={`${button} hover:bg-red-500/80 hover:text-white`} style={NO_DRAG}><CloseIcon /></button>
    </div>
  )
}

/** Area da cui si trascina la finestra frameless (Wails legge questa custom property). */
export const DRAG = { '--wails-draggable': 'drag' } as React.CSSProperties
export const NO_DRAG = { '--wails-draggable': 'no-drag' } as React.CSSProperties

async function toggleMaximise(): Promise<void> {
  const { WindowToggleMaximise } = await import('../../wailsjs/runtime/runtime')
  WindowToggleMaximise()
}

interface WindowTitlebar {
  /** Vero con la finestra frameless ("Titlebar app"): la barra dell'app fa da barra della finestra. */
  active: boolean
  props: { className?: string; style?: React.CSSProperties; onDoubleClick?: (event: React.MouseEvent) => void }
}

/**
 * Niente barra del titolo separata: con la finestra frameless l'header del pannello diventa
 * la barra della finestra (si trascina dagli spazi vuoti, doppio clic ingrandisce), come JetBrains e VS Code.
 */
export function useWindowTitlebar(): WindowTitlebar {
  const active = useAppStore((state) => state.appWindowChrome)
  if (!active) return { active, props: {} }
  return {
    active,
    props: {
      className: 'app-titlebar',
      style: DRAG,
      onDoubleClick: (event) => {
        if (!(event.target as HTMLElement).closest('button, input, select, a, [data-window-controls]')) void toggleMaximise()
      },
    },
  }
}

/** Riduci / ingrandisci / chiudi in coda a una barra che fa da barra della finestra. */
export function TitlebarWindowControls({ height = 'h-10' }: { height?: string }) {
  const { active } = useWindowTitlebar()
  if (!active) return null
  return <><span className="ml-1 h-5 w-px shrink-0 bg-border-1" aria-hidden="true" /><WindowControls height={height} /></>
}

function MinusIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function MaxIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.75" y="2.75" width="6.5" height="6.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  )
}
