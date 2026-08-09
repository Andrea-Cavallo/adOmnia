import { useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { useUiTranslation } from '@/lib/uiI18n'

export function Titlebar() {
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

  return (
    <header
      className="flex h-8 items-stretch justify-between border-b border-border-1 bg-surface-1 select-none"
      style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 pl-2.5">
        <img src="/logo.png" alt="adOmnia" className="h-[18px] w-[18px] object-contain" />
        <span className="text-[11px] text-text-3">adOmnia paratus.</span>
      </div>

      <div className="flex h-8 items-stretch" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <div className="flex h-8 items-stretch">
          <button
            onClick={onMinimise}
            aria-label={tr('Minimize window')}
            className="grid h-8 w-10 place-items-center text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          >
            <MinusIcon />
          </button>
          <button
            onClick={onMaximise}
            aria-label={tr('Maximize or restore window')}
            className="grid h-8 w-10 place-items-center text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          >
            <MaxIcon />
          </button>
          <button
            onClick={onClose}
            aria-label={tr('Close window')}
            className="grid h-8 w-10 place-items-center text-text-3 transition-colors hover:bg-red-500/80 hover:text-white"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
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
