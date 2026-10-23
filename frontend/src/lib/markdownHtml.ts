/**
 * HTML grezzo dentro il Markdown (i README di GitHub ne sono pieni: `<p align="center">`, `<img width>`, `<br>`, `<details>`).
 *
 * Non si passa il testo al DOM: l'HTML viene riletto tag per tag e RICOSTRUITO da un elenco chiuso di tag e attributi, con i
 * valori sempre escapati e gli URL filtrati. Quello che non è nell'elenco (script, iframe, style, on*="…") sparisce e il suo
 * testo resta visibile come testo. Funziona uguale nel browser e nei test.
 */

const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'center', 'a', 'img', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's',
  'del', 'code', 'kbd', 'sub', 'sup', 'small', 'details', 'summary', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol',
  'li', 'blockquote', 'picture', 'pre',
])
const VOID_TAGS = new Set(['br', 'hr', 'img'])
const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'align', 'colspan', 'rowspan', 'open'])
const URL_ATTRS = new Set(['href', 'src'])
/** Tag con corpo che può contenere righe vuote: il blocco continua finché il tag di apertura non si chiude. */
const CONTAINER = 'p|div|details|center|table|ul|ol|blockquote|picture|h[1-6]'

// Tag name and attribute text in one lazy-free run: the name is split from the body in the loop below, so the
// attribute part cannot re-read the characters the name already consumed (that overlap is quadratic on "<a<a…").
const TAG = /<(\/?)([a-zA-Z][^<>]*)>/g
const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9]*/
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (value: string) => escapeText(value).replace(/"/g, '&quot;')

export interface HtmlRenderOptions {
  /** Trasforma e filtra un URL (href, src) prima di scriverlo. */
  url: (value: string, attribute: 'href' | 'src') => string
}

function renderAttributes(tag: string, source: string, options: HtmlRenderOptions): string {
  let out = ''
  let align = ''
  for (const match of source.matchAll(ATTR)) {
    const name = match[1].toLowerCase()
    if (!ALLOWED_ATTRS.has(name)) continue
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (name === 'align') { align = value.toLowerCase(); continue }
    if (URL_ATTRS.has(name)) {
      if ((name === 'href' && tag !== 'a') || (name === 'src' && tag !== 'img')) continue
      out += ` ${name}="${escapeAttr(options.url(value, name as 'href' | 'src'))}"`
    } else if (name === 'width' || name === 'height') {
      if (/^\d{1,4}%?$/.test(value.trim())) out += ` ${name}="${escapeAttr(value.trim())}"`
    } else {
      out += ` ${name}="${escapeAttr(value)}"`
    }
  }
  if (tag === 'img') out += ' class="max-w-full inline-block align-middle" loading="lazy"'
  if (tag === 'a') out += ' class="text-accent underline hover:opacity-80 transition-opacity"'
  if (/^h[1-6]$/.test(tag)) out += ' class="font-semibold text-text-1 mt-4 mb-2"'
  if (tag === 'p') out += ' class="text-text-2 text-xs leading-relaxed my-1"'
  if (align === 'center' || align === 'right') out += ` style="text-align:${align}"`
  return out
}

/** Riscrive un frammento HTML con i soli tag e attributi ammessi. */
export function renderSafeHtml(html: string, options: HtmlRenderOptions): string {
  let out = ''
  let last = 0
  const stack: string[] = []
  let text = html
  for (let previous = ''; previous !== text; ) {
    previous = text
    text = text.replace(/<!--[\s\S]*?-->/g, '') // repeat: "<!<!-- -->-- x -->" must not leave a comment behind
  }
  for (const match of text.matchAll(TAG)) {
    out += escapeText(text.slice(last, match.index))
    last = match.index + match[0].length
    const closing = match[1] === '/'
    const name = TAG_NAME.exec(match[2])?.[0] ?? match[2]
    const tag = name.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) continue
    if (closing) {
      const position = stack.lastIndexOf(tag)
      if (position < 0) continue
      while (stack.length > position) out += `</${stack.pop()}>`
      continue
    }
    out += `<${tag}${renderAttributes(tag, match[2].slice(name.length), options)}${VOID_TAGS.has(tag) ? ' /' : ''}>`
    if (!VOID_TAGS.has(tag) && !match[0].endsWith('/>')) stack.push(tag)
    else if (!VOID_TAGS.has(tag)) out += `</${tag}>`
  }
  out += escapeText(text.slice(last))
  while (stack.length) out += `</${stack.pop()}>`
  return out
}

const BLOCK_START = new RegExp(`^ {0,3}<(?:(${CONTAINER})\\b|img\\b|a\\b|br\\b|hr\\b|!--)`, 'i')

/**
 * Cerca i blocchi HTML (righe che iniziano con un tag a livello di blocco) e li sostituisce con `replace(blocco)`.
 * Un contenitore (`<p>`, `<div>`, `<details>`…) dura finché non si chiude, anche attraverso righe vuote; gli altri blocchi
 * (`<img>`, `<a>` di un badge, `<br>`) finiscono alla prima riga vuota.
 */
export function replaceHtmlBlocks(text: string, replace: (block: string) => string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let index = 0
  while (index < lines.length) {
    const start = BLOCK_START.exec(lines[index])
    if (!start) { out.push(lines[index]); index += 1; continue }
    let end = index
    if (start[0].trim().startsWith('<!--')) {
      while (end < lines.length - 1 && !lines[end].includes('-->')) end += 1
    } else if (start[1]) {
      const name = start[1].toLowerCase()
      const open = new RegExp(`<${name}\\b`, 'gi')
      const close = new RegExp(`</${name}\\s*>`, 'gi')
      let depth = 0
      for (end = index; end < lines.length; end += 1) {
        depth += (lines[end].match(open) ?? []).length - (lines[end].match(close) ?? []).length
        if (depth <= 0) break
      }
      if (depth > 0) { end = index; while (end < lines.length - 1 && lines[end + 1].trim() !== '') end += 1 }
    } else {
      while (end < lines.length - 1 && lines[end + 1].trim() !== '') end += 1
    }
    out.push(replace(lines.slice(index, end + 1).join('\n')))
    index = end + 1
  }
  return out.join('\n')
}
