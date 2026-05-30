import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Bold, Italic, Code, Link, Image, Heading, Eye, Columns } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function sanitizeUrl(url: string): string {
  const t = url.trim()
  if (!t) return '#'
  const lower = t.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return '#'
  if (lower.startsWith('data:') && !lower.startsWith('data:image/')) return '#'
  return t
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
// Two-pass approach:
//   Pass 1 — extract fenced code blocks into placeholders (multi-line safe)
//   Pass 2 — process the remaining text line-by-line

function renderMarkdown(md: string): string {
  // ── Pass 1: protect fenced code blocks ────────────────────────────────────
  const codeBlocks: string[] = []
  const text = md.replace(/```([\w.-]*)\r?\n([\s\S]*?)```/g, (_m, lang, code) => {
    const label = lang || 'code'
    const safe = esc(code.replace(/\r?\n$/, ''))
    const html = [
      '<div class="my-3 rounded-lg border border-border-2 overflow-hidden text-xs">',
      `<div class="flex items-center gap-2 px-3 py-1.5 bg-surface-3 border-b border-border-2">`,
      `<span class="font-mono font-semibold text-text-4 uppercase tracking-widest" style="font-size:9px">${esc(label)}</span>`,
      '</div>',
      '<pre class="bg-surface-2 px-4 py-3 overflow-x-auto m-0 leading-5">',
      `<code class="font-mono text-text-2 whitespace-pre" style="font-size:11px">${safe}</code>`,
      '</pre></div>',
    ].join('')
    const idx = codeBlocks.length
    codeBlocks.push(html)
    return `\x00BLK${idx}\x00`
  })

  // ── Pass 2: line-by-line processing ───────────────────────────────────────

  // Inline transforms on a single line of (already-escaped) text
  function inlineEsc(raw: string): string {
    let s = raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // inline code — protect from further transforms
    const inlineCodes: string[] = []
    s = s.replace(/`([^`\n]+)`/g, (_m, c) => {
      const html = `<code class="bg-surface-2 border border-border-2 px-1 py-px rounded font-mono text-accent-light" style="font-size:11px">${esc(c)}</code>`
      const i = inlineCodes.length; inlineCodes.push(html)
      return `\x00IC${i}\x00`
    })
    // bold+italic, bold, italic
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="font-semibold text-text-1"><em>$1</em></strong>')
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-text-1">$1</strong>')
    s = s.replace(/\*([^*\n]+)\*/g, '<em class="italic text-text-2">$1</em>')
    // images (before links)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) =>
      `<img src="${sanitizeUrl(src)}" alt="${esc(alt)}" class="max-w-full rounded my-2 block" loading="lazy" />`)
    // links
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) =>
      `<a href="${sanitizeUrl(href)}" class="text-accent underline hover:opacity-80 transition-opacity">${label}</a>`)
    // restore inline codes
    inlineCodes.forEach((h, i) => { s = s.replace(`\x00IC${i}\x00`, h) })
    return s
  }

  const lines = text.split('\n')
  const out: string[] = []
  let inUL = false
  let inOL = false

  function closeList() {
    if (inUL) { out.push('</ul>'); inUL = false }
    if (inOL) { out.push('</ol>'); inOL = false }
  }

  for (const raw of lines) {
    const line = raw.trim()

    // ── code block placeholder ──
    const bm = line.match(/^\x00BLK(\d+)\x00$/)
    if (bm) { closeList(); out.push(codeBlocks[parseInt(bm[1])]); continue }

    // ── thematic break ──
    if (/^---+$/.test(line)) { closeList(); out.push('<hr class="border-border-1 my-4" />'); continue }

    // ── headings (test on raw line so we don't double-escape) ──
    {
      const h6 = raw.match(/^#{6} (.+)/); if (h6) { closeList(); out.push(`<h6 class="text-xs font-medium text-text-3 mt-2 mb-0.5">${inlineEsc(h6[1])}</h6>`); continue }
      const h5 = raw.match(/^#{5} (.+)/); if (h5) { closeList(); out.push(`<h5 class="text-xs font-semibold text-text-2 mt-2 mb-0.5">${inlineEsc(h5[1])}</h5>`); continue }
      const h4 = raw.match(/^#{4} (.+)/); if (h4) { closeList(); out.push(`<h4 class="text-sm font-semibold text-text-1 mt-3 mb-1">${inlineEsc(h4[1])}</h4>`); continue }
      const h3 = raw.match(/^#{3} (.+)/); if (h3) { closeList(); out.push(`<h3 class="text-base font-semibold text-text-1 mt-4 mb-1 pb-1 border-b border-border-1">${inlineEsc(h3[1])}</h3>`); continue }
      const h2 = raw.match(/^#{2} (.+)/); if (h2) { closeList(); out.push(`<h2 class="text-lg font-bold text-text-1 mt-5 mb-2 pb-1 border-b border-border-1">${inlineEsc(h2[1])}</h2>`); continue }
      const h1 = raw.match(/^#{1} (.+)/); if (h1) { closeList(); out.push(`<h1 class="text-xl font-bold text-text-1 mt-4 mb-3 pb-1.5 border-b border-border-1">${inlineEsc(h1[1])}</h1>`); continue }
    }

    // ── blockquote ──
    {
      const bq = raw.match(/^>\s*(.+)/)
      if (bq) { closeList(); out.push(`<blockquote class="border-l-[3px] border-accent/50 pl-3 my-2 text-text-3 italic text-xs leading-relaxed">${inlineEsc(bq[1])}</blockquote>`); continue }
    }

    // ── unordered list ──
    {
      const ul = raw.match(/^[-*+]\s+(.+)/)
      if (ul) {
        if (!inUL) { closeList(); out.push('<ul class="my-1.5 space-y-0.5">'); inUL = true }
        out.push(`<li class="flex gap-1.5 text-text-2 text-xs leading-relaxed"><span class="text-text-4 select-none shrink-0 mt-px">•</span><span>${inlineEsc(ul[1])}</span></li>`)
        continue
      }
    }

    // ── ordered list ──
    {
      const ol = raw.match(/^(\d+)\.\s+(.+)/)
      if (ol) {
        if (!inOL) { closeList(); out.push('<ol class="my-1.5 space-y-0.5 list-decimal list-inside">'); inOL = true }
        out.push(`<li class="text-text-2 text-xs leading-relaxed">${inlineEsc(ol[2])}</li>`)
        continue
      }
    }

    // ── non-list line: close any open list ──
    if (inUL || inOL) closeList()

    // ── empty line ──
    if (!line) { out.push('<div class="h-2"></div>'); continue }

    // ── paragraph ──
    out.push(`<p class="text-text-2 text-xs leading-relaxed my-1">${inlineEsc(raw)}</p>`)
  }

  closeList()
  return out.join('\n')
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MarkdownPanel() {
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<'split' | 'edit' | 'preview'>('split')

  const editorRef  = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const syncLock   = useRef(false)

  const onEditorScroll = useCallback(() => {
    if (syncLock.current || !editorRef.current || !previewRef.current) return
    const ed = editorRef.current
    const pr = previewRef.current
    const pct = ed.scrollTop / Math.max(1, ed.scrollHeight - ed.clientHeight)
    syncLock.current = true
    pr.scrollTop = pct * (pr.scrollHeight - pr.clientHeight)
    requestAnimationFrame(() => { syncLock.current = false })
  }, [])

  const onPreviewScroll = useCallback(() => {
    if (syncLock.current || !editorRef.current || !previewRef.current) return
    const ed = editorRef.current
    const pr = previewRef.current
    const pct = pr.scrollTop / Math.max(1, pr.scrollHeight - pr.clientHeight)
    syncLock.current = true
    ed.scrollTop = pct * (ed.scrollHeight - ed.clientHeight)
    requestAnimationFrame(() => { syncLock.current = false })
  }, [])

  useEffect(() => {
    fetch('/README.md')
      .then((res) => (res.ok ? res.text() : Promise.reject()))
      .then((text) => setContent(text))
      .catch(() => setContent([
        '# Welcome',
        '',
        'Start writing **markdown** here.',
        '',
        '## Features',
        '',
        '- Live split preview',
        '- Syntax-highlighted code blocks',
        '- Images, links, tables',
        '',
        '```js',
        'function hello() {',
        '  return "world"',
        '}',
        '```',
      ].join('\n')))
  }, [])

  const html = useMemo(() => renderMarkdown(content), [content])

  const insertAtCursor = (wrapper: (s: string) => string) => {
    const ta = document.querySelector<HTMLTextAreaElement>('.md-editor-textarea')
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = content.slice(start, end)
    const replacement = wrapper(selected)
    setContent(content.slice(0, start) + replacement + content.slice(end))
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = start + replacement.length
      ta.selectionEnd = start + replacement.length
    })
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-1 bg-surface-1 flex-shrink-0">
        <button onClick={() => insertAtCursor((s) => s ? `**${s}**` : '**bold**')}    className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Bold"><Bold size={13} /></button>
        <button onClick={() => insertAtCursor((s) => s ? `*${s}*`  : '*italic*')}     className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Italic"><Italic size={13} /></button>
        <button onClick={() => insertAtCursor((s) => s ? `\`${s}\`` : '`code`')}       className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Inline code"><Code size={13} /></button>
        <button onClick={() => insertAtCursor((s) => s ? `[${s}](url)` : '[text](url)')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Link"><Link size={13} /></button>
        <button onClick={() => insertAtCursor((s) => s ? `![${s}](url)` : '![alt](url)')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Image"><Image size={13} /></button>
        <button onClick={() => insertAtCursor((s) => s ? `## ${s}` : '## Heading')}   className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors" title="Heading"><Heading size={13} /></button>
        <div className="w-px h-4 bg-border-1 mx-1" />
        <button onClick={() => insertAtCursor(() => '```\n\n```')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded hover:bg-surface-2 transition-colors font-mono text-[9px]" title="Code block">{'{ }'}</button>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 bg-surface-2 rounded p-0.5">
          <button onClick={() => setMode('edit')}    className={cn('px-2 py-0.5 text-[10px] rounded transition-colors', mode === 'edit'    ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')} title="Edit only">Edit</button>
          <button onClick={() => setMode('split')}   className={cn('px-2 py-0.5 text-[10px] rounded transition-colors', mode === 'split'   ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')} title="Split view"><Columns size={11} /></button>
          <button onClick={() => setMode('preview')} className={cn('px-2 py-0.5 text-[10px] rounded transition-colors', mode === 'preview' ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')} title="Preview only"><Eye size={11} /></button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {mode !== 'preview' && (
          <textarea
            ref={editorRef}
            className={cn(
              'md-editor-textarea p-4 bg-surface-0 font-mono text-xs text-text-1',
              'placeholder:text-text-4 resize-none focus:outline-none overflow-y-auto leading-relaxed',
              mode === 'split' ? 'w-1/2 border-r border-border-1' : 'flex-1',
            )}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onScroll={mode === 'split' ? onEditorScroll : undefined}
            placeholder="Write markdown here…"
            spellCheck={false}
          />
        )}
        {mode !== 'edit' && (
          <div
            ref={previewRef}
            className={cn('p-5 overflow-y-auto bg-surface-0', mode === 'split' ? 'w-1/2' : 'flex-1')}
            onScroll={mode === 'split' ? onPreviewScroll : undefined}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}
