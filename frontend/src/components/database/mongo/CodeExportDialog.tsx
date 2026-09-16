import { useMemo, useState } from 'react'
import { Check, Code2, Copy, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CODE_LANGUAGES, generateCode, type CodeLanguage, type CodeRequest } from './codegen'

export function CodeExportDialog({ request, onClose }: { request: CodeRequest; onClose: () => void }) {
  const [lang, setLang] = useState<CodeLanguage>('shell')
  const [copied, setCopied] = useState(false)
  const code = useMemo(() => generateCode(request, lang), [lang, request])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch { /* clipboard unavailable: the code stays selectable */ }
  }

  return (
    <div className="fixed inset-0 z-[260] grid place-items-center bg-black/55 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="code-export-title" className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-md border border-border-2 bg-surface-2 shadow-2xl">
        <div className="flex h-11 flex-none items-center gap-2 border-b border-border-1 px-3.5">
          <Code2 size={14} className="text-accent" />
          <h3 id="code-export-title" className="text-[13px] font-semibold text-text-1">Export {request.kind === 'find' ? 'query' : 'pipeline'} to code</h3>
          <button type="button" onClick={onClose} aria-label="Close code export" className="ml-auto grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={14} /></button>
        </div>
        <div className="flex flex-none items-center gap-1 border-b border-border-1 px-3 py-2">
          {CODE_LANGUAGES.map((l) => (
            <button key={l.id} type="button" onClick={() => setLang(l.id)} aria-pressed={lang === l.id} className={cn('h-7 rounded-md px-2.5 text-[11.5px] font-medium', lang === l.id ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3 hover:text-text-1')}>{l.label}</button>
          ))}
          <button type="button" onClick={() => void copy()} className="ml-auto flex h-7 items-center gap-1.5 rounded-md border border-border-2 px-2.5 text-[11.5px] text-text-2 hover:bg-surface-3 hover:text-text-1">
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />} Copy
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto bg-surface-0 p-4 font-mono text-[11.5px] leading-5 text-text-1">{code}</pre>
      </div>
    </div>
  )
}
