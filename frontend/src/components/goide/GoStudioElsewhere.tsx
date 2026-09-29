import { AppWindow, ArrowDownToLine, X } from 'lucide-react'

type GoStudioElsewhereProps =
  | { mode: 'elsewhere'; projectName: string; onFocus: () => void; onBringBack: () => void }
  | { mode: 'closed'; projectName: string; onClose: () => void }

/**
 * Stato mostrato quando il progetto attivo è modificabile in un'altra finestra: qui non si
 * aprono editor, così due finestre non possono mai sovrascrivere gli stessi buffer.
 */
export function GoStudioElsewhere(props: GoStudioElsewhereProps) {
  const elsewhere = props.mode === 'elsewhere'
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div role="status" className="w-full max-w-md border border-border-1 bg-surface-1 p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md border border-accent/30 bg-accent/10 text-accent">
            <AppWindow size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text-1">
              {elsewhere ? `${props.projectName} is open in a separate window` : 'This project is no longer open'}
            </h2>
            <p className="mt-0.5 text-[11px] text-text-3">
              {elsewhere
                ? 'Edit it there, or move it back: the other window asks about unsaved changes first.'
                : 'It was closed from the main window. Close this window to continue there.'}
            </p>
          </div>
        </div>
        {elsewhere ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={props.onFocus} className="flex h-8 items-center justify-center gap-2 rounded-md bg-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><AppWindow size={13} /> Show Window</button>
            <button type="button" onClick={props.onBringBack} className="flex h-8 items-center justify-center gap-2 rounded-md border border-border-2 px-3 text-xs font-semibold text-text-2 hover:border-accent hover:text-text-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><ArrowDownToLine size={13} /> Move Back Here</button>
          </div>
        ) : (
          <button type="button" onClick={props.onClose} className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><X size={13} /> Close Window</button>
        )}
      </div>
    </div>
  )
}
