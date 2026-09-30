import { useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { useUiTranslation } from '@/lib/uiI18n'

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
    const { Quit } = await import('../../wailsjs/runtime/runtime')
    Quit()
  }, [])

  const button = `grid ${height} w-11 place-items-center text-text-3 transition-colors`
  return (
    <div className={`flex ${height} shrink-0 items-stretch`} style={NO_DRAG}>
      <button type="button" onClick={onMinimise} aria-label={tr('Minimize window')} className={`${button} hover:bg-surface-3 hover:text-text-1`} style={NO_DRAG}><MinusIcon /></button>
      <button type="button" onClick={onMaximise} aria-label={tr('Maximize or restore window')} className={`${button} hover:bg-surface-3 hover:text-text-1`} style={NO_DRAG}><MaxIcon /></button>
      <button type="button" onClick={onClose} aria-label={tr('Close window')} className={`${button} hover:bg-red-500/80 hover:text-white`} style={NO_DRAG}><CloseIcon /></button>
    </div>
  )
}

/** Area da cui si trascina la finestra frameless (Wails legge questa custom property). */
export const DRAG = { '--wails-draggable': 'drag' } as React.CSSProperties
export const NO_DRAG = { '--wails-draggable': 'no-drag' } as React.CSSProperties

export function Titlebar() {
  return (
    <header className="flex h-8 items-stretch justify-between border-b border-border-1 bg-surface-1 select-none" style={DRAG}>
      <div className="flex items-center gap-2 pl-2.5">
        <img src="/logo.png" alt="adOmnia" data-brand-mark className="h-[18px] w-[18px] object-contain" />
        <span className="text-[11px] text-text-3">adOmnia paratus.</span>
      </div>
      <WindowControls />
    </header>
  )
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
