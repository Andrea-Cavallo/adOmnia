import { useId, useRef, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Search, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import './goStudioModal.css'

export type GoStudioModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'
export type GoStudioTone = 'accent' | 'warning' | 'danger' | 'success' | 'info'

interface GoStudioModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  icon?: ComponentType<{ size?: number }>
  tone?: GoStudioTone
  size?: GoStudioModalSize
  /** Altezza fissa per viste con liste o diff, così il modale non salta mentre il contenuto cambia. */
  tall?: boolean
  /** Linea sotto l'header: per i modali con liste o contenuti densi. */
  divided?: boolean
  /** Corpo senza padding: per diff, editor o liste a tutta larghezza. */
  flush?: boolean
  /** In alto invece che al centro: palette e ricerche. */
  top?: boolean
  /** Sopra ogni altro livello dell'app (conferme di chiusura). */
  elevated?: boolean
  /** Il clic sul velo non chiude: per decisioni da non perdere per sbaglio (Esc resta attivo). */
  persistent?: boolean
  /** Azioni piccole nell'header, a sinistra della X (aggiorna, copia…). */
  actions?: ReactNode
  footer?: ReactNode
  footerStart?: ReactNode
  /** Etichetta accessibile quando il titolo non è testo semplice. */
  ariaLabel?: string
  className?: string
  bodyClassName?: string
  children?: ReactNode
}

/**
 * Guscio unico dei modali di gO Studio: velo con blur, superficie, header con icona e tono,
 * corpo scorrevole e footer con azioni. Montato in un portale con font proprio, così è identico
 * ovunque venga aperto (anche fuori dalla radice di Go Studio).
 */
export function GoStudioModal({
  open, onClose, title, subtitle, icon: Icon, tone = 'accent', size = 'md', tall, divided, flush, top, elevated, persistent,
  actions, footer, footerStart, ariaLabel, className = '', bodyClassName = '', children,
}: GoStudioModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModalFocusTrap(open, onClose, dialogRef)
  if (!open) return null

  return createPortal(
    <div className={`gs-modal-backdrop ad-modal-backdrop ${top ? 'gs-modal-top' : ''} ${elevated ? 'gs-modal-elevated' : ''}`} onClick={persistent ? undefined : onClose} data-a11y-click-exempt="dialog-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`gs-modal gs-modal-${size} ${tall ? 'gs-modal-tall' : ''} ${className}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={`gs-modal-header ${divided ? 'gs-modal-header-divided' : ''}`}>
          {Icon && <span className={`gs-modal-icon gs-tone-${tone}`} aria-hidden="true"><Icon size={17} /></span>}
          <div className="gs-modal-heading">
            <h2 id={titleId} className="gs-modal-title">{title}</h2>
            {subtitle && <p className="gs-modal-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="gs-modal-actions">{actions}</div>}
        </header>
        <div className={`gs-modal-body ${flush ? 'gs-modal-body-flush' : ''} ${bodyClassName}`}>{children}</div>
        {(footer || footerStart) && (
          <footer className="gs-modal-footer">
            <div className="gs-modal-footer-start">{footerStart}</div>
            {footer}
          </footer>
        )}
        {/* Ultima nel DOM: il focus iniziale va al contenuto, non alla X. */}
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="gs-btn gs-btn-ghost gs-btn-sm gs-btn-icon gs-modal-close"><X size={15} /></button>
      </div>
    </div>,
    document.body,
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'

interface GoStudioButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  small?: boolean
  loading?: boolean
  icon?: ComponentType<{ size?: number; className?: string }>
}

/** Pulsante unico di gO Studio: stessa altezza, raggio, peso e feedback in tutti i modali. */
export function GoStudioButton({ variant = 'secondary', small, loading, icon: Icon, className = '', children, disabled, type = 'button', ...rest }: GoStudioButtonProps) {
  const size = small ? 13 : 14
  return (
    <button type={type} disabled={disabled || loading} className={`gs-btn gs-btn-${variant} ${small ? 'gs-btn-sm' : ''} ${className}`} {...rest}>
      {loading ? <Loader2 size={size} className="animate-spin" /> : Icon ? <Icon size={size} /> : null}
      {children}
    </button>
  )
}

interface GoStudioFieldProps {
  label: ReactNode
  hint?: ReactNode
  className?: string
  children: ReactNode
}

/** Campo con label sopra e aiuto sotto. Il controllo dentro usa la classe gs-input. */
export function GoStudioField({ label, hint, className = '', children }: GoStudioFieldProps) {
  return (
    <label className={`gs-field ${className}`}>
      <span className="gs-label">{label}</span>
      {children}
      {hint && <span className="gs-hint">{hint}</span>}
    </label>
  )
}

interface GoStudioAlertProps {
  tone?: GoStudioTone
  icon?: ComponentType<{ size?: number }>
  children: ReactNode
}

/** Avviso in linea (errore, attenzione, informazione) con lo stesso linguaggio visivo ovunque. */
export function GoStudioAlert({ tone = 'danger', icon: Icon, children }: GoStudioAlertProps) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`gs-alert gs-tone-${tone}`}>
      {Icon && <Icon size={15} />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Anteprima di un comando prima di eseguirlo: cosa parte e dove. */
export function GoStudioCommandPreview({ command, workingDirectory }: { command?: string | null; workingDirectory?: string | null }) {
  return (
    <div className="gs-surface flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="gs-section-title">Command</span>
        <code className="gs-mono break-all text-text-1">{command || '—'}</code>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="gs-section-title">Working directory</span>
        <code className="gs-mono break-all text-text-3">{workingDirectory || '—'}</code>
      </div>
    </div>
  )
}

interface GoStudioPaletteProps {
  open: boolean
  onClose: () => void
  ariaLabel: string
  icon?: ComponentType<{ size?: number }>
  /** Testo fisso prima del campo, es. "Implement on *Server". */
  prefix?: ReactNode
  /** Il campo di ricerca, con classe gs-palette-input. */
  input: ReactNode
  /** A destra del campo: spinner o conteggio risultati. */
  meta?: ReactNode
  /** Riga di schede sotto la ricerca (Search Everywhere). */
  tabs?: ReactNode
  /** Suggerimenti da tastiera in fondo. Default: frecce, Invio, Esc. */
  hints?: ReactNode
  wide?: boolean
  children: ReactNode
}

const DEFAULT_HINTS = <><span><span className="gs-kbd">↑</span><span className="gs-kbd">↓</span> move</span><span><span className="gs-kbd">Enter</span> open</span><span><span className="gs-kbd">Esc</span> close</span></>

/** Guscio delle palette di ricerca: stessa forma per file, simboli, azioni e interfacce. */
export function GoStudioPalette({ open, onClose, ariaLabel, icon: Icon = Search, prefix, input, meta, tabs, hints = DEFAULT_HINTS, wide, children }: GoStudioPaletteProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
  if (!open) return null
  return createPortal(
    <div className="gs-modal-backdrop gs-modal-top ad-modal-backdrop" onClick={onClose} data-a11y-click-exempt="dialog-backdrop">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={ariaLabel} tabIndex={-1} className={`gs-modal gs-palette ${wide ? 'gs-palette-lg' : ''}`} onClick={(event) => event.stopPropagation()}>
        <div className="gs-palette-header">
          <Icon size={17} />
          {prefix && <span className="gs-palette-prefix">{prefix}</span>}
          {input}
          {meta && <span className="gs-palette-meta">{meta}</span>}
        </div>
        {tabs && <div className="gs-palette-tabs">{tabs}</div>}
        <div className="gs-palette-results">{children}</div>
        {hints && <div className="gs-palette-footer">{hints}</div>}
      </div>
    </div>,
    document.body,
  )
}
