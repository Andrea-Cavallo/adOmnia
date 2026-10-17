import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Code2, Columns2, Eye } from 'lucide-react'
import { MarkdownPreview } from '@/components/markdown/MarkdownPreview'
import { renderMarkdown } from '@/lib/markdownDoc'
import { readGoIDEAssetDataUrl } from '@/lib/code-studio-api'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { isMermaidPath, mermaidAsMarkdown, useMarkdownMode, type CodeStudioMarkdownMode } from './codeStudioMarkdownMode'
import { localMarkdownAssets, substituteMarkdownAssets } from './codeStudioMarkdownAssets'
import { CodeStudioMarkdownTools, MarkdownToolsButton } from './CodeStudioMarkdownTools'

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

export type { CodeStudioMarkdownMode } from './codeStudioMarkdownMode'

const MODES: { id: CodeStudioMarkdownMode; label: string; icon: typeof Eye }[] = [
  { id: 'editor', label: 'Editor only', icon: Code2 },
  { id: 'split', label: 'Editor and Preview', icon: Columns2 },
  { id: 'preview', label: 'Preview only', icon: Eye },
]

export function isMarkdownDocument(document: GoIDEEditorDocument): boolean {
  return document.document.language === 'markdown' || /\.(md|markdown)$/i.test(document.document.relativePath) || isMermaidPath(document.document.relativePath)
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

interface CodeStudioMarkdownViewProps {
  document: GoIDEEditorDocument
  mode: CodeStudioMarkdownMode
  onModeChange: (mode: CodeStudioMarkdownMode) => void
  editor: ReactNode
}

/** Editor Markdown di Code Studio: lo stesso rendering del modulo Markdown di adOmnia, aggiornato mentre scrivi. */
export function CodeStudioMarkdownView({ document, mode, onModeChange, editor }: CodeStudioMarkdownViewProps) {
  const openDocument = useCodeStudioStore((state) => state.openDocument)
  const path = document.document.relativePath
  const assets = useMarkdownAssets(document)
  // GS-7.4: outline, backlinks e grafo come pannelli laterali (niente per i file Mermaid puri).
  const [toolsOpen, setToolsOpen] = useState(false)
  const showTools = toolsOpen && !isMermaidPath(path)
  const html = useMemo(() => (mode === 'editor' ? '' : renderMarkdown(substituteMarkdownAssets(isMermaidPath(path) ? mermaidAsMarkdown(document.buffer) : document.buffer, assets), path)), [document.buffer, path, mode, assets])
  const openLink = (href: string) => {
    const target = resolveMarkdownLink(path, href)
    if (!target) return
    // file.go#L12 (anche nei documenti generati da Documentation) apre la riga, come su GitHub.
    const line = /#L(\d+)$/.exec(href)
    if (line) void useCodeStudioStore.getState().openLocation(target, Number(line[1]), 1)
    else void openDocument(target)
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      {mode !== 'preview' && <div className="min-h-0 min-w-0 flex-1">{editor}</div>}
      {mode === 'split' && <div className="w-px shrink-0 bg-border-1" aria-hidden="true" />}
      {mode !== 'editor' && <MarkdownPreview className="min-w-0 bg-[var(--gs-island,var(--color-surface-0))]" html={html} onInternalLink={openLink} />}
      {showTools && <CodeStudioMarkdownTools document={document} onJumpToLine={(line) => void useCodeStudioStore.getState().openLocation(path, line, 1)} />}
      <div className="absolute right-4 top-2 z-10 flex items-center gap-1">
        {!isMermaidPath(path) && <MarkdownToolsButton open={toolsOpen} onToggle={() => setToolsOpen((value) => !value)} />}
        <div role="radiogroup" aria-label="Markdown view" className="flex gap-0.5 rounded-lg border border-border-1 bg-surface-1/90 p-0.5 shadow-sm backdrop-blur">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} aria-label={label} title={label} onClick={() => onModeChange(id)} className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${mode === id ? 'bg-accent/20 text-accent' : 'text-text-4 hover:bg-surface-3 hover:text-text-2'}`}>
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Markdown con il modo ricordato per documento (anteprima al primo apertura): lo usano editor principale e pannello diviso. */
export function CodeStudioMarkdownDocument({ document, editor }: { document: GoIDEEditorDocument; editor: ReactNode }) {
  const [mode, setMode] = useMarkdownMode(`${document.document.sessionId}:${document.document.relativePath}`)
  return <CodeStudioMarkdownView document={document} mode={mode} onModeChange={setMode} editor={editor} />
}
