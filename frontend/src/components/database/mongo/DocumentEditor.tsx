import { useState } from 'react'
import { parseEditorDocuments } from './bson'

interface DocumentEditorProps {
  initial: string
  busy: boolean
  submitLabel: string
  hint?: string
  onCancel: () => void
  onSubmit: (text: string) => void | Promise<void>
}

// ponytail: plain textarea with live validation; swap for Monaco if users ask for autocompletion.
export function DocumentEditor({ initial, busy, submitLabel, hint, onCancel, onSubmit }: DocumentEditorProps) {
  const [text, setText] = useState(initial)
  let parseError = ''
  try { parseEditorDocuments(text) } catch (e) { parseError = e instanceof Error ? e.message : String(e) }

  const submit = () => { if (!parseError && !busy) void onSubmit(text) }

  return (
    <div className="flex flex-col">
      <textarea
        autoFocus
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Tab') {
            e.preventDefault()
            const el = e.currentTarget
            const { selectionStart: start, selectionEnd: end } = el
            setText(`${text.slice(0, start)}  ${text.slice(end)}`)
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2 })
          }
        }}
        aria-label="Document JSON"
        rows={Math.min(24, Math.max(6, text.split('\n').length + 1))}
        className="w-full resize-y rounded-t-md bg-surface-0 px-3 py-2 font-mono text-[11.5px] leading-5 text-text-1 outline-none"
      />
      <div className="flex items-center gap-2 border-t border-border-1 px-3 py-2">
        <span className={parseError ? 'truncate text-[11px] text-error' : 'truncate text-[11px] text-text-4'}>
          {parseError || hint || 'Extended JSON or shell syntax · Ctrl+Enter to save'}
        </span>
        <button type="button" onClick={onCancel} className="ml-auto h-7 flex-none rounded-md border border-border-2 px-2.5 text-[11.5px] text-text-2 hover:bg-surface-3">Cancel</button>
        <button type="button" onClick={submit} disabled={!!parseError || busy} className="h-7 flex-none rounded-md bg-accent px-3 text-[11.5px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40">{submitLabel}</button>
      </div>
    </div>
  )
}
