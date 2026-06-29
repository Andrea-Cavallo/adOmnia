import { useEffect, useRef, useState } from 'react'
import { DialogOverlay, DialogContent, DialogHeader, DialogFooter, DialogBody } from './dialog'
import { Button } from './button'
import { PencilLine, X } from 'lucide-react'

interface PromptProps {
  open: boolean
  title: string
  placeholder?: string
  description?: string
  defaultValue?: string
  confirmLabel?: string
  multiline?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function Prompt({
  open,
  title,
  placeholder = '',
  description,
  defaultValue = '',
  confirmLabel = 'OK',
  multiline = false,
  onConfirm,
  onCancel,
}: PromptProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setValue(defaultValue)
      // Focus after animation
      setTimeout(() => {
        if (multiline) {
          textareaRef.current?.focus()
        } else {
          inputRef.current?.focus()
        }
      }, 50)
    }
  }, [open, defaultValue, multiline])

  const handleConfirm = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }

  if (!open) return null

  return (
    <DialogOverlay open={open} onClose={onCancel}>
      <DialogContent size={multiline ? 'lg' : 'sm'} className="relative">
        <div className="h-px shrink-0 bg-gradient-to-r from-transparent via-accent/80 to-transparent" />
        <DialogHeader className="border-b-0 bg-surface-1 pb-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
              <PencilLine size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[14px] font-semibold text-text-1">{title}</h2>
              {description && <p className="mt-0.5 text-[11px] leading-relaxed text-text-3">{description}</p>}
            </div>
          </div>
          <button onClick={onCancel} title="Close" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-4 transition-colors hover:bg-surface-2 hover:text-text-1">
            <X size={16} />
          </button>
        </DialogHeader>
        <DialogBody className="pt-2">
          {!multiline && <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.12em] text-text-4">Name</label>}
          {multiline ? (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancel()
              }}
              placeholder={placeholder}
              rows={10}
              className="w-full px-3 py-2 bg-surface-2 border border-border-2 rounded text-sm font-mono text-text-1 placeholder:text-text-4 focus:border-accent outline-none transition-colors resize-none"
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm()
                if (e.key === 'Escape') onCancel()
              }}
              placeholder={placeholder}
              className="h-10 w-full rounded-lg border border-border-2 bg-surface-2 px-3.5 font-mono text-[13px] text-text-1 outline-none transition-all placeholder:text-text-4 hover:border-border-3 focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel} className="px-4">
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!value.trim()} className="px-4">
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogOverlay>
  )
}
