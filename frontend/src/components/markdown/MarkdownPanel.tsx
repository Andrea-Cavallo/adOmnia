import { useState, useMemo, useEffect } from 'react'
import { Bold, Italic, Code, Link, Image, Heading, Eye, Columns } from 'lucide-react'
import { cn } from '@/lib/utils'

function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (/[\u0000-\u001f"'<>\\]/.test(trimmed)) return '#'
  if (/^(https?:|#|\/|\.\/|\.\.\/|mailto:)/i.test(trimmed)) return trimmed
  return '#'
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderMarkdown(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Code blocks (fenced)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre class="bg-surface-2 border border-border-2 rounded p-3 my-2 overflow-x-auto"><code class="text-xs font-mono text-text-2">${code.trim()}</code></pre>`
  )

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-surface-2 px-1 py-0.5 rounded text-[11px] font-mono text-accent-light">$1</code>')

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4 class="text-sm font-semibold text-text-1 mt-3 mb-1">$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-text-1 mt-4 mb-1">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-text-1 mt-4 mb-2">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-text-1 mt-4 mb-2">$1</h1>')

  // Bold / Italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Links — sanitize href to block javascript:/data:/vbscript: URLs
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) =>
    `<a href="${escapeAttr(sanitizeUrl(href))}" class="text-accent-light underline">${text}</a>`
  )

  // Images — sanitize src and escape alt to prevent attribute injection
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) =>
    `<img src="${escapeAttr(sanitizeUrl(src))}" alt="${escapeAttr(alt)}" class="max-w-full rounded my-2" />`
  )

  // HR
  html = html.replace(/^---$/gm, '<hr class="border-border-1 my-3" />')

  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="border-l-2 border-accent/40 pl-3 italic text-text-3 my-2">$1</blockquote>')

  // Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li class="text-text-2 ml-4 list-disc">$1</li>')

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="text-text-2 ml-4 list-decimal">$1</li>')

  // Paragraphs: wrap lines not already in a block tag
  const lines = html.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/^<(h[1-4]|pre|hr|blockquote|li|ul|ol|div)/.test(line.trim())) {
      out.push(line)
    } else if (line.trim() === '') {
      out.push('<br />')
    } else {
      out.push(`<p class="text-text-2 text-xs leading-relaxed my-1">${line}</p>`)
    }
  }
  html = out.join('\n')

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li class="text-text-2 ml-4 list-disc">.+?<\/li>\n?)+/g, '<ul class="my-1">$&</ul>')
  html = html.replace(/(<li class="text-text-2 ml-4 list-decimal">.+?<\/li>\n?)+/g, '<ol class="my-1">$&</ol>')

  return html
}

export function MarkdownPanel() {
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<'split' | 'edit' | 'preview'>('split')

  useEffect(() => {
    fetch('/README.md')
      .then((res) => (res.ok ? res.text() : Promise.reject()))
      .then((text) => setContent(text))
      .catch(() => setContent('# Welcome\n\nStart writing **markdown** here.\n\n- Item 1\n- Item 2\n\n```js\nconsole.log("hello")\n```'))
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
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-1">
        <button onClick={() => insertAtCursor((s) => s ? `**${s}**` : '**bold**')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded" title="Bold"><Bold size={13} /></button>
        <button onClick={() => insertAtCursor((s) => s ? `*${s}*` : '*italic*')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded" title="Italic"><Italic size={13} /></button>
        <button onClick={() => insertAtCursor((s) => s ? `\`${s}\`` : '`code`')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded" title="Code"><Code size={13} /></button>
        <button onClick={() => insertAtCursor((s) => s ? `[${s}](url)` : '[text](url)')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded" title="Link"><Link size={13} /></button>
        <button onClick={() => insertAtCursor((s) => s ? `![${s}](url)` : '![alt](url)')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded" title="Image"><Image size={13} /></button>
        <button onClick={() => insertAtCursor((s) => s ? `## ${s}` : '## Heading')} className="w-6 h-6 flex items-center justify-center text-text-3 hover:text-text-1 rounded" title="Heading"><Heading size={13} /></button>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 bg-surface-2 rounded p-0.5">
          <button onClick={() => setMode('edit')} className={cn('px-2 py-0.5 text-[10px] rounded', mode === 'edit' ? 'bg-surface-3 text-text-1' : 'text-text-4')} title="Edit only">Edit</button>
          <button onClick={() => setMode('split')} className={cn('px-2 py-0.5 text-[10px] rounded', mode === 'split' ? 'bg-surface-3 text-text-1' : 'text-text-4')} title="Split view"><Columns size={11} /></button>
          <button onClick={() => setMode('preview')} className={cn('px-2 py-0.5 text-[10px] rounded', mode === 'preview' ? 'bg-surface-3 text-text-1' : 'text-text-4')} title="Preview only"><Eye size={11} /></button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {mode !== 'preview' && (
          <textarea
            className={`md-editor-textarea ${mode === 'split' ? 'w-1/2' : 'flex-1'} p-4 bg-surface-0 border-r border-border-1 font-mono text-xs text-text-1 placeholder:text-text-4 resize-none focus:outline-none`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write markdown..."
            spellCheck={false}
          />
        )}
        {mode !== 'edit' && (
          <div
            className={`${mode === 'split' ? 'w-1/2' : 'flex-1'} p-4 overflow-auto`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}
