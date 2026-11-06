import { useEffect } from 'react'
import { Code2, X } from 'lucide-react'
import { useApiCodeLinkStore } from '@/lib/api-code-link/linkStore'

/**
 * Lightweight chooser used when an endpoint or a handler has several matches.
 * It never appears for the common single match, so it stays out of the way.
 */
export function ApiCodeLinkHost() {
  const chooser = useApiCodeLinkStore((s) => s.chooser)
  const closeChooser = useApiCodeLinkStore((s) => s.closeChooser)
  useEffect(() => {
    let disposeSync: (() => void) | undefined
    void import('@/lib/api-code-link/actions').then((module) => { disposeSync = module.startApiCodeLinkSync() })
    return () => disposeSync?.()
  }, [])
  useEffect(() => {
    if (!chooser) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeChooser() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [chooser, closeChooser])
  if (!chooser) return null
  return (
    <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeChooser() }}
      className="fixed inset-0 z-[320] flex items-center justify-center bg-black/45 p-4">
      <div role="dialog" aria-modal="true" aria-label={chooser.title}
        className="w-full max-w-[440px] overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-xl shadow-black/40">
        <header className="flex items-start gap-2 border-b border-border-1 px-3 py-2.5">
          <Code2 size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[12.5px] font-semibold text-text-1">{chooser.title}</h2>
            {chooser.description && <p className="mt-0.5 text-[11.5px] leading-4 text-text-4">{chooser.description}</p>}
          </div>
          <button type="button" onClick={closeChooser} aria-label="Close" className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-text-1">
            <X size={12} />
          </button>
        </header>
        <ul className="max-h-[min(60vh,420px)] overflow-auto py-1">
          {chooser.choices.map((choice) => (
            <li key={choice.id}>
              <button type="button" data-autofocus
                onClick={() => { closeChooser(); void choice.run() }}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-surface-3 focus:bg-surface-3 focus:outline-none">
                <span className="flex items-center gap-2">
                  <span className="truncate font-mono text-[12px] font-semibold text-text-1">{choice.label}</span>
                  {choice.project && <span className="shrink-0 rounded border border-border-2 px-1.5 py-0.5 text-[10px] text-text-3">{choice.project}</span>}
                </span>
                <span className="truncate font-mono text-[11px] text-text-4">{choice.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
