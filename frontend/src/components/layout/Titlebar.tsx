import { useCallback } from 'react'

export function Titlebar() {

  const onMinimise = useCallback(async () => {
    const { WindowMinimise } = await import('../../wailsjs/runtime/runtime')
    WindowMinimise()
  }, [])

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
      className="h-9 flex items-stretch justify-between bg-surface-1 border-b border-border-1 select-none"
      style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 pl-3">
        <img src="/logo.png" alt="adOmnia" className="h-5 w-5 object-contain" />
        <span className="text-text-3 text-xs">adOmnia paratus.</span>
      </div>

      <div className="flex h-9 items-stretch" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <div className="flex h-9 items-stretch">
          <button
            onClick={onMinimise}
            aria-label="Minimize window"
            className="grid h-9 w-[46px] place-items-center text-text-3 hover:bg-surface-3 hover:text-text-1 transition-colors"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          >
            <MinusIcon />
          </button>
          <button
            onClick={onMaximise}
            aria-label="Maximize or restore window"
            className="grid h-9 w-[46px] place-items-center text-text-3 hover:bg-surface-3 hover:text-text-1 transition-colors"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          >
            <MaxIcon />
          </button>
          <button
            onClick={onClose}
            aria-label="Close window"
            className="grid h-9 w-[46px] place-items-center text-text-3 hover:bg-red-500/80 hover:text-white transition-colors"
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
