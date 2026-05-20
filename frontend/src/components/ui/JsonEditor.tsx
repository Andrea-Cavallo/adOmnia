import { useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface JsonEditorProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  error?: string
  className?: string
  minHeight?: string
}

const DEPTH_BRACKET_COLORS = ['text-text-1', 'json-bracket-1', 'json-bracket-2', 'json-bracket-3']

function tokenizeJson(text: string): Array<{ text: string; cls: string }> {
  const tokens: Array<{ text: string; cls: string }> = []
  let i = 0
  let depth = 0

  while (i < text.length) {
    const ch = text[i]

    // Whitespace / newlines
    if (/[\s\n\r]/.test(ch)) {
      tokens.push({ text: ch, cls: '' })
      i++
      continue
    }

    // String
    if (ch === '"') {
      let str = '"'
      i++
      while (i < text.length) {
        const c = text[i]
        str += c
        if (c === '\\') { i++; if (i < text.length) { str += text[i]; i++ }; continue }
        if (c === '"') { i++; break }
        i++
      }
      // Lookahead for colon → key
      let j = i
      while (j < text.length && /\s/.test(text[j])) j++
      const isKey = text[j] === ':'
      tokens.push({ text: str, cls: isKey ? 'json-key' : 'json-string' })
      continue
    }

    // Number
    if (ch === '-' || /[0-9]/.test(ch)) {
      let num = ch
      i++
      while (i < text.length && /[0-9.eE+\-]/.test(text[i])) { num += text[i]; i++ }
      tokens.push({ text: num, cls: 'json-number' })
      continue
    }

    // Keywords
    if (text.startsWith('true', i)) { tokens.push({ text: 'true', cls: 'json-bool' }); i += 4; continue }
    if (text.startsWith('false', i)) { tokens.push({ text: 'false', cls: 'json-bool' }); i += 5; continue }
    if (text.startsWith('null', i)) { tokens.push({ text: 'null', cls: 'json-null' }); i += 4; continue }

    // Brackets — color by depth
    if (ch === '{' || ch === '[') {
      const cls = DEPTH_BRACKET_COLORS[depth % DEPTH_BRACKET_COLORS.length]
      tokens.push({ text: ch, cls })
      depth++
      i++
      continue
    }
    if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1)
      const cls = DEPTH_BRACKET_COLORS[depth % DEPTH_BRACKET_COLORS.length]
      tokens.push({ text: ch, cls })
      i++
      continue
    }

    // Punctuation
    if (ch === ':' || ch === ',') {
      tokens.push({ text: ch, cls: 'text-text-3' })
      i++
      continue
    }

    tokens.push({ text: ch, cls: '' })
    i++
  }

  return tokens
}

const CLS_MAP: Record<string, string> = {
  'json-key':       'var(--color-json-key)',
  'json-string':    'var(--color-json-string)',
  'json-number':    'var(--color-json-number)',
  'json-bool':      'var(--color-json-bool)',
  'json-null':      'var(--color-json-null)',
  'text-text-3':    'var(--color-text-3)',
  'text-text-1':    'var(--color-text-1)',
  // Bracket depth colors — themes can override via json-bracket-{1,2,3}
  'json-bracket-1': 'var(--color-json-bracket-1, #FACC15)',
  'json-bracket-2': 'var(--color-json-bracket-2, #22D3EE)',
  'json-bracket-3': 'var(--color-json-bracket-3, #F472B6)',
}

function buildHtml(tokens: Array<{ text: string; cls: string }>): string {
  return tokens.map(({ text, cls }) => {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (!cls) return escaped
    const color = CLS_MAP[cls]
    if (color) return `<span style="color:${color}">${escaped}</span>`
    return escaped
  }).join('')
}

const SHARED_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  lineHeight: '1.6',
  padding: '12px',
  margin: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  whiteSpace: 'pre',
  overflowWrap: 'normal',
  wordBreak: 'normal',
  tabSize: 2,
}

export function JsonEditor({ value, onChange, placeholder, error, className, minHeight = '280px' }: JsonEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  const highlight = useCallback((text: string) => {
    if (!text.trim()) return `<span style="color:var(--color-text-4)">${placeholder ?? ''}</span>`
    try {
      const tokens = tokenizeJson(text)
      return buildHtml(tokens)
    } catch {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
  }, [placeholder])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const { selectionStart: s, selectionEnd: end } = ta
      const next = value.substring(0, s) + '  ' + value.substring(end)
      onChange(next)
      requestAnimationFrame(() => {
        if (taRef.current) {
          taRef.current.selectionStart = s + 2
          taRef.current.selectionEnd = s + 2
        }
      })
    }
  }

  return (
    <div
      className={cn(
        'relative rounded border overflow-hidden',
        error ? 'border-error/60' : 'border-border-2 focus-within:border-accent',
        className
      )}
      style={{ minHeight }}
    >
      {/* Highlighted layer */}
      <pre
        aria-hidden
        style={{
          ...SHARED_STYLE,
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          color: 'var(--color-text-1)',
          background: 'var(--color-surface-2)',
          overflow: 'hidden',
        }}
        dangerouslySetInnerHTML={{ __html: highlight(value) }}
      />
      {/* Editable textarea */}
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        style={{
          ...SHARED_STYLE,
          position: 'relative',
          display: 'block',
          width: '100%',
          height: '100%',
          minHeight,
          color: 'transparent',
          caretColor: 'var(--color-text-1)',
          resize: 'none',
          background: 'transparent',
        }}
      />
    </div>
  )
}
