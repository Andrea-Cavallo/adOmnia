import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Code2, Columns2, Eye } from 'lucide-react'
import { MarkdownPreview } from '@/components/markdown/MarkdownPreview'
import { renderMarkdown } from '@/lib/markdownDoc'
import { readGoIDEAssetDataUrl } from '@/lib/goide-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { localMarkdownAssets, substituteMarkdownAssets } from './goStudioMarkdownAssets'

// Cache per sessione: gli asset locali non vengono riletti a ogni battitura del Markdown.
const assetCache = new Map<string, string>()

function useMarkdownAssets(document: GoIDEEditorDocument): Map<string, string> {
  const sessionId = document.document.sessionId
  const path = document.document.relativePath
  const [assets, setAssets] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    const refs = localMarkdownAssets(document.buffer, path)
    if (refs.length === 0) { setAssets(new Map()); return }
    let cancelled = false
    Promise.all(refs.map(async (ref) => {
      const key = `${sessionId}\u0000${ref.relative}`
      const cached = assetCache.get(key)
      if (cached) return [ref.raw, cached] as const
      try {
        const dataUrl = await readGoIDEAssetDataUrl(sessionId, ref.relative)
        assetCache.set(key, dataUrl)
        return [ref.raw, dataUrl] as const
      } catch {
        return null
      }
    })).then((entries) => {
      if (cancelled) return
      const map = new Map<string, string>()
      for (const entry of entries) if (entry) map.set(entry[0], entry[1])
      setAssets(map)
    })
    return () => { cancelled = true }
  }, [document.buffer, path, sessionId])
  return assets
}

export type GoStudioMarkdownMode = 'editor' | 'split' | 'preview'

const MODES: { id: GoStudioMarkdownMode; label: string; icon: typeof Eye }[] = [
  { id: 'editor', label: 'Editor only', icon: Code2 },
  { id: 'split', label: 'Editor and Preview', icon: Columns2 },
  { id: 'preview', label: 'Preview only', icon: Eye },
]

export function isMarkdownDocument(document: GoIDEEditorDocument): boolean {
  return document.document.language === 'markdown' || /\.(md|markdown)$/i.test(document.document.relativePath)
}

/** Risolve un link relativo del preview rispetto al file corrente: "../docs/A.md#x" → "docs/A.md". */
export function resolveMarkdownLink(fromPath: string, href: string): string | null {
  let target = href.replace(/^adomnia-md:/, '').split('#')[0].split('?')[0]
  if (!target) return null
  try { target = decodeURIComponent(target) } catch { /* resta com'è */ }
  if (!/\.[A-Za-z0-9]+$/.test(target)) target += '.md'
  const base = target.startsWith('/') ? [] : fromPath.split('/').slice(0, -1)
  const parts: string[] = []
  for (const part of [...base, ...target.split('/')]) {
    if (!part || part === '.') continue
    if (part === '..') { if (parts.length === 0) return null; parts.pop() } else parts.push(part)
  }
  return parts.join('/')
}

interface GoStudioMarkdownViewProps {
  document: GoIDEEditorDocument
  mode: GoStudioMarkdownMode
  onModeChange: (mode: GoStudioMarkdownMode) => void
  editor: ReactNode
}

/** Editor Markdown di Go Studio: lo stesso rendering del modulo Markdown di adOmnia, aggiornato mentre scrivi. */
export function GoStudioMarkdownView({ document, mode, onModeChange, editor }: GoStudioMarkdownViewProps) {
  const openDocument = useGoIDEStore((state) => state.openDocument)
  const path = document.document.relativePath
  const assets = useMarkdownAssets(document)
  const html = useMemo(() => (mode === 'editor' ? '' : renderMarkdown(substituteMarkdownAssets(document.buffer, assets), path)), [document.buffer, path, mode, assets])
  const openLink = (href: string) => {
    const target = resolveMarkdownLink(path, href)
    if (target) void openDocument(target)
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      {mode !== 'preview' && <div className="min-h-0 min-w-0 flex-1">{editor}</div>}
      {mode === 'split' && <div className="w-px shrink-0 bg-border-1" aria-hidden="true" />}
      {mode !== 'editor' && <MarkdownPreview className="min-w-0 bg-[var(--gs-island,var(--color-surface-0))]" html={html} onInternalLink={openLink} />}
      <div role="radiogroup" aria-label="Markdown view" className="absolute right-4 top-2 z-10 flex gap-0.5 rounded-lg border border-border-1 bg-surface-1/90 p-0.5 shadow-sm backdrop-blur">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} aria-label={label} title={label} onClick={() => onModeChange(id)} className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${mode === id ? 'bg-accent/20 text-accent' : 'text-text-4 hover:bg-surface-3 hover:text-text-2'}`}>
            <Icon size={13} />
          </button>
        ))}
      </div>
    </div>
  )
}
