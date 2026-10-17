// Gli asset locali del Markdown (immagini) non passano dal filesystem del WebView: il backend li
// legge dal progetto come data URL. Queste funzioni sono pure e testabili.

export interface MarkdownAssetRef {
  /** Sorgente come scritto nel Markdown, usato per la sostituzione. */
  raw: string
  /** Percorso relativo al progetto, o null se l'asset è esterno. */
  relative: string
}

function imagePattern(): RegExp {
  return /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g
}

/** Un asset è esterno quando non è un file relativo al progetto (http, data:, file:, #…). */
export function isExternalMarkdownAsset(src: string): boolean {
  return /^(https?:|mailto:|tel:|data:|file:|#|adomnia-md:|\/\/)/i.test(src.trim())
}

/** Risolve "docs/img/a.png" rispetto al file Markdown, confinato alla radice del progetto. */
export function resolveMarkdownAssetPath(fromPath: string, src: string): string | null {
  const clean = src.trim().split(/\s+/)[0]
  if (!clean || isExternalMarkdownAsset(clean)) return null
  let decoded = clean
  try { decoded = decodeURIComponent(clean) } catch { /* resta com'è */ }
  const base = fromPath.replace(/\\/g, '/').split('/').slice(0, -1)
  const parts: string[] = []
  for (const part of [...base, ...decoded.replace(/\\/g, '/').split('/')]) {
    if (!part || part === '.') continue
    if (part === '..') { if (parts.length === 0) return null; parts.pop() } else parts.push(part)
  }
  return parts.join('/')
}

/** Immagini locali referenziate dal Markdown, senza duplicati. */
export function localMarkdownAssets(markdown: string, fromPath: string): MarkdownAssetRef[] {
  const seen = new Set<string>()
  const refs: MarkdownAssetRef[] = []
  for (const match of markdown.matchAll(imagePattern())) {
    const raw = match[1]
    if (seen.has(raw)) continue
    const relative = resolveMarkdownAssetPath(fromPath, raw)
    if (!relative) continue
    seen.add(raw)
    refs.push({ raw, relative })
  }
  return refs
}

/** Sostituisce le sorgenti locali con i data URL risolti, lasciando intatto il resto. */
export function substituteMarkdownAssets(markdown: string, assets: Map<string, string>): string {
  if (assets.size === 0) return markdown
  return markdown.replace(imagePattern(), (full, raw: string) => {
    const data = assets.get(raw)
    return data ? full.replace(raw, data) : full
  })
}
