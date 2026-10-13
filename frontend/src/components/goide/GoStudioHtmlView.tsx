import { useMemo, useState, type ReactNode } from 'react'
import { Code2, Columns2, Eye, Globe2, RefreshCw, ShieldCheck } from 'lucide-react'
import type { GoIDEEditorDocument } from '@/stores/goide'

export type GoStudioHtmlMode = 'editor' | 'split' | 'preview'

const MODES: { id: GoStudioHtmlMode; label: string; icon: typeof Eye }[] = [
  { id: 'editor', label: 'Editor only', icon: Code2 },
  { id: 'split', label: 'Editor and Preview', icon: Columns2 },
  { id: 'preview', label: 'Preview only', icon: Eye },
]

export function isHtmlDocument(document: GoIDEEditorDocument): boolean {
  return document.document.language === 'html' || /\.html?$/i.test(document.document.relativePath)
}

/** Inserisce una CSP nel documento mostrato dall'iframe. La rete resta spenta finché l'utente non la abilita. */
export function htmlPreviewDocument(source: string, network: boolean): string {
  const policy = network
    ? "default-src 'self' data: blob: http: https:; script-src 'unsafe-inline' 'unsafe-eval' data: blob: http: https:; style-src 'unsafe-inline' data: blob: http: https:; connect-src http: https: ws: wss:; frame-src http: https:"
    : "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'"
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  if (/<head(?:\s[^>]*)?>/i.test(source)) return source.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`)
  if (/<html(?:\s[^>]*)?>/i.test(source)) return source.replace(/<html(?:\s[^>]*)?>/i, (html) => `${html}<head>${meta}</head>`)
  return `<!doctype html><html><head>${meta}</head><body>${source}</body></html>`
}

interface GoStudioHtmlViewProps {
  document: GoIDEEditorDocument
  mode: GoStudioHtmlMode
  onModeChange: (mode: GoStudioHtmlMode) => void
  editor: ReactNode
}

/** Browser HTML integrato: live preview isolata, con accesso di rete solo dopo un gesto esplicito. */
export function GoStudioHtmlView({ document, mode, onModeChange, editor }: GoStudioHtmlViewProps) {
  const [network, setNetwork] = useState(false)
  const [reload, setReload] = useState(0)
  const html = useMemo(() => htmlPreviewDocument(document.buffer, network), [document.buffer, network])

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      {mode !== 'preview' && <div className="min-h-0 min-w-0 flex-1">{editor}</div>}
      {mode === 'split' && <div className="w-px shrink-0 bg-border-1" aria-hidden="true" />}
      {mode !== 'editor' && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-2 text-[10.5px] text-text-3">
            {network ? <Globe2 size={12} className="text-warning" /> : <ShieldCheck size={12} className="text-success" />}
            <span>{network ? 'Network enabled for this preview' : 'Network blocked'}</span>
            <button type="button" onClick={() => setNetwork((value) => !value)} className="gs-btn gs-btn-sm ml-auto" aria-pressed={network}>
              {network ? 'Block network' : 'Allow network'}
            </button>
            <button type="button" onClick={() => setReload((value) => value + 1)} className="go-studio-icon-button h-6 w-6" aria-label="Reload HTML preview" title="Reload HTML preview"><RefreshCw size={12} /></button>
          </div>
          <iframe
            key={`${document.document.id}:${reload}`}
            title={`HTML preview: ${document.document.name}`}
            srcDoc={html}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
            className="min-h-0 flex-1 border-0 bg-white"
          />
        </div>
      )}
      <div role="radiogroup" aria-label="HTML view" className="absolute right-4 top-10 z-10 flex gap-0.5 rounded-lg border border-border-1 bg-surface-1/90 p-0.5 shadow-sm backdrop-blur">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} aria-label={label} title={label} onClick={() => onModeChange(id)} className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${mode === id ? 'bg-accent/20 text-accent' : 'text-text-4 hover:bg-surface-3 hover:text-text-2'}`}>
            <Icon size={13} />
          </button>
        ))}
      </div>
    </div>
  )
}
