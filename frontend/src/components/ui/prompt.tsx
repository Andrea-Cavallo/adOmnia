import { useEffect, useRef, useState } from 'react'
import { DialogOverlay, DialogContent, DialogHeader, DialogFooter, DialogBody } from './dialog'
import { Button } from './button'
import { X } from 'lucide-react'

interface PromptProps {
  open: boolean
  title: string
  placeholder?: string
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
      <DialogContent size={multiline ? 'lg' : 'sm'}>
        <DialogHeader>
          <span className="text-sm font-semibold text-text-1">{title}</span>
          <button onClick={onCancel} className="text-text-4 hover:text-text-1 transition-colors">
            <X size={16} />
          </button>
        </DialogHeader>
        <DialogBody>
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
              className="w-full h-9 px-3 bg-surface-2 border border-border-2 rounded text-sm font-mono text-text-1 placeholder:text-text-4 focus:border-accent outline-none transition-colors"
            />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogOverlay>
  )
}
