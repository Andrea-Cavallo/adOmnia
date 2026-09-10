import { cn } from '@/lib/utils'

/** Shared toolbar primitives, used by the toolbar and its popovers. */

export function ToolButton({ onClick, icon, label, title, disabled, active }: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  title: string
  disabled?: boolean
  /** Set when the button opens a panel that is currently visible. */
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] transition-colors disabled:opacity-35',
        active
          ? 'border-accent/50 bg-accent/15 text-accent-light'
          : 'border-border-2 text-text-2 hover:border-accent/40 hover:text-text-1',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

export function IconToggle({ active, onClick, title, children }: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'grid h-7 w-7 place-items-center rounded border transition-colors',
        active ? 'border-accent/50 bg-accent/20 text-accent-light' : 'border-border-2 text-text-3 hover:border-accent/40 hover:text-text-1',
      )}
    >
      {children}
    </button>
  )
}

export function Popover({ children, onClose, wide = false, extraWide = false }: {
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
  extraWide?: boolean
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className={cn(
        'absolute right-0 top-8 z-40 min-w-[176px] rounded-md border border-border-2 bg-surface-1 p-1 shadow-[0_12px_40px_rgba(0,0,0,.45)]',
        wide && 'w-72',
        extraWide && 'left-0 right-auto w-auto',
      )}>
        {children}
      </div>
    </>
  )
}

/** A removable chip for a user-entered field name. */
export function FieldChip({ field, title, onRemove }: { field: string; title: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      title={title}
      className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-1 font-mono text-[9px] text-text-2 hover:text-error"
    >
      {field}
      <span aria-hidden="true">×</span>
    </button>
  )
}

/** Single-input form used to add a field name to a preference list. */
export function AddFieldForm({ value, onChange, onSubmit, placeholder, action }: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  action: string
}) {
  return (
    <form
      className="flex gap-1"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault()
        onSubmit()
      }}
    >
      <input
        value={value}
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-7 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-accent"
      />
      <button className="h-7 rounded border border-accent/40 px-2 text-[10px] text-accent-light hover:bg-accent/15">{action}</button>
    </form>
  )
}
