import { useRef, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface JsonEditorProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  error?: string
  className?: string
  minHeight?: string
  resolvedVars?: Record<string, string>
  hasActiveEnv?: boolean
}

// ─── Var tooltip types ────────────────────────────────────────────────────────

interface VarTooltip {
  varName: string
  content: string
  type: 'resolved' | 'missing' | 'empty' | 'noenv'
  x: number
  y: number
}

const TOOLTIP_BORDER: Record<VarTooltip['type'], string> = {
  resolved: 'border-success/40 text-success',
  missing:  'border-error/40  text-error',
  empty:    'border-warning/40 text-warning',
  noenv:    'border-warning/40 text-warning',
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

let _ctx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_ctx) {
    try { _ctx = document.createElement('canvas').getContext('2d') } catch { /* not available */ }
  }
  return _ctx
}

/**
 * Returns the absolute character index in `ta.value` that sits under
 * the given clientX/clientY coordinates, accounting for padding and scroll.
 */
function charIndexAtPos(ta: HTMLTextAreaElement, clientX: number, clientY: number): number {
  const ctx = getMeasureCtx()
  if (!ctx) return 0
  const rect = ta.getBoundingClientRect()
  const cs   = window.getComputedStyle(ta)
  ctx.font   = `${cs.fontSize} ${cs.fontFamily}`

  const paddingLeft = parseFloat(cs.paddingLeft) || 0
  const paddingTop  = parseFloat(cs.paddingTop)  || 0
  const lineHeight  = parseFloat(cs.lineHeight)  || parseFloat(cs.fontSize) * 1.6

  const relX = clientX - rect.left - paddingLeft + ta.scrollLeft
  const relY = clientY - rect.top  - paddingTop  + ta.scrollTop

  const lineIndex   = Math.max(0, Math.floor(relY / lineHeight))
  const lines       = ta.value.split('\n')
  const clampedLine = Math.min(lineIndex, lines.length - 1)
  const line        = lines[clampedLine]

  const lineStart = lines.slice(0, clampedLine).reduce((a, l) => a + l.length + 1, 0)

  let accumulated = 0
  for (let i = 0; i < line.length; i++) {
    const cw = ctx.measureText(line[i]).width
    if (relX < accumulated + cw / 2) return lineStart + i
    accumulated += cw
  }
  return lineStart + line.length
}

// ─── Var tooltip resolution (same logic as VarHighlightInput) ─────────────────

function resolveVarTooltip(
  text: string,
  resolvedVars: Record<string, string>,
  hasActiveEnv: boolean,
  charIdx: number,
): Omit<VarTooltip, 'x' | 'y'> | null {
  const re = /\{\{([^}]+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (charIdx >= m.index && charIdx <= m.index + m[0].length) {
      const varName = m[1].trim()
      if (!hasActiveEnv) return { varName, content: 'No active environment', type: 'noenv' }
      if (varName in resolvedVars) {
        const val = resolvedVars[varName]
        if (val === '') return { varName, content: '(empty value)', type: 'empty' }
        return { varName, content: val, type: 'resolved' }
      }
      return { varName, content: 'Variable not found', type: 'missing' }
    }
  }
  return null
}

// ─── JSON tokenizer ───────────────────────────────────────────────────────────

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
    if (text.startsWith('true', i))  { tokens.push({ text: 'true',  cls: 'json-bool' }); i += 4; continue }
    if (text.startsWith('false', i)) { tokens.push({ text: 'false', cls: 'json-bool' }); i += 5; continue }
    if (text.startsWith('null', i))  { tokens.push({ text: 'null',  cls: 'json-null' }); i += 4; continue }

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

// ─── HTML builder ─────────────────────────────────────────────────────────────

const CLS_MAP: Record<string, string> = {
  'json-key':       'var(--color-json-key)',
  'json-string':    'var(--color-json-string)',
  'json-number':    'var(--color-json-number)',
  'json-bool':      'var(--color-json-bool)',
  'json-null':      'var(--color-json-null)',
  'text-text-3':    'var(--color-text-3)',
  'text-text-1':    'var(--color-text-1)',
  'json-bracket-1': 'var(--color-json-bracket-1, #FACC15)',
  'json-bracket-2': 'var(--color-json-bracket-2, #22D3EE)',
  'json-bracket-3': 'var(--color-json-bracket-3, #F472B6)',
}

/**
 * For json-string tokens that contain `{{...}}` patterns, split the token
 * into segments, coloring vars with their resolved/missing/noenv state.
 */
function injectVarHighlights(
  rawText: string,
  baseColor: string,
  resolvedVars: Record<string, string>,
  hasActiveEnv: boolean,
): string {
  const re = /\{\{([^}]+)\}\}/g
  let last = 0
  let result = ''
  let m: RegExpExecArray | null

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  while ((m = re.exec(rawText)) !== null) {
    if (m.index > last) {
      result += `<span style="color:${baseColor}">${esc(rawText.slice(last, m.index))}</span>`
    }
    const varName = m[1].trim()

    let color: string
    let bg: string
    if (!hasActiveEnv) {
      color = 'var(--color-warning)'; bg = 'rgba(234,179,8,0.15)'
    } else if (varName in resolvedVars && resolvedVars[varName] !== '') {
      color = 'var(--color-success)'; bg = 'rgba(106,191,105,0.15)'
    } else {
      color = 'var(--color-error)'; bg = 'rgba(239,68,68,0.12)'
    }

    result += `<span style="color:${color};background:${bg};border-radius:2px">${esc(m[0])}</span>`
    last = m.index + m[0].length
  }

  if (last < rawText.length) {
    result += `<span style="color:${baseColor}">${esc(rawText.slice(last))}</span>`
  }

  return result || `<span style="color:${baseColor}">${esc(rawText)}</span>`
}

function buildHtml(
  tokens: Array<{ text: string; cls: string }>,
  resolvedVars?: Record<string, string>,
  hasActiveEnv?: boolean,
): string {
  return tokens.map(({ text, cls }) => {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (!cls) return escaped
    const color = CLS_MAP[cls]
    // Inject var highlighting for string values (not keys) that contain {{...}}
    if (cls === 'json-string' && resolvedVars && text.includes('{{')) {
      return injectVarHighlights(
        text,
        color ?? 'var(--color-json-string)',
        resolvedVars,
        hasActiveEnv ?? false,
      )
    }
    if (color) return `<span style="color:${color}">${escaped}</span>`
    return escaped
  }).join('')
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const SHARED_STYLE: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '12px',
  lineHeight:    '1.6',
  padding:       '12px',
  margin:        0,
  border:        'none',
  outline:       'none',
  background:    'transparent',
  whiteSpace:    'pre',
  overflowWrap:  'normal',
  wordBreak:     'normal',
  tabSize:       2,
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JsonEditor({
  value,
  onChange,
  placeholder,
  error,
  className,
  minHeight = '280px',
  resolvedVars,
  hasActiveEnv,
}: JsonEditorProps) {
  const taRef  = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const [tooltip, setTooltip] = useState<VarTooltip | null>(null)

  const highlight = useCallback((text: string) => {
    if (!text.trim()) return `<span style="color:var(--color-text-4)">${placeholder ?? ''}</span>`
    try {
      const tokens = tokenizeJson(text)
      return buildHtml(tokens, resolvedVars, hasActiveEnv)
    } catch {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
  }, [placeholder, resolvedVars, hasActiveEnv])

  // Keep the highlight layer in sync with the textarea's scroll position.
  const syncScroll = useCallback(() => {
    const ta  = taRef.current
    const pre = preRef.current
    if (!ta || !pre) return
    pre.scrollTop  = ta.scrollTop
    pre.scrollLeft = ta.scrollLeft
  }, [])

  // Non-passive wheel listener for scroll speed control.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const multiplier = Math.abs(e.deltaY) > 50 ? 2.5 : 1.0
      ta.scrollTop += e.deltaY * multiplier
      syncScroll()
    }
    ta.addEventListener('wheel', onWheel, { passive: false })
    return () => ta.removeEventListener('wheel', onWheel)
  }, [syncScroll])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta  = e.currentTarget
      const { selectionStart: s, selectionEnd: end } = ta
      const next = value.substring(0, s) + '  ' + value.substring(end)
      onChange(next)
      requestAnimationFrame(() => {
        if (taRef.current) {
          taRef.current.selectionStart = s + 2
          taRef.current.selectionEnd   = s + 2
        }
      })
    }
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (!resolvedVars || !taRef.current) { setTooltip(null); return }
      const idx = charIndexAtPos(taRef.current, e.clientX, e.clientY)
      const tip = resolveVarTooltip(value, resolvedVars, hasActiveEnv ?? false, idx)
      if (tip) {
        setTooltip({ ...tip, x: e.clientX, y: e.clientY })
      } else {
        setTooltip(null)
      }
    },
    [resolvedVars, hasActiveEnv, value],
  )

  return (
    <div
      className={cn(
        'relative rounded border overflow-hidden',
        error ? 'border-error/60' : 'border-border-2 focus-within:border-accent',
        className,
      )}
      style={{ minHeight }}
    >
      {/* Highlighted layer — scrolled in sync with the textarea via syncScroll */}
      <pre
        ref={preRef}
        aria-hidden
        style={{
          ...SHARED_STYLE,
          position:      'absolute',
          inset:         0,
          pointerEvents: 'none',
          color:         'var(--color-text-1)',
          background:    'var(--color-surface-2)',
          overflow:      'hidden',
        }}
        dangerouslySetInnerHTML={{ __html: highlight(value) }}
      />

      {/* Editable textarea */}
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        spellCheck={false}
        style={{
          ...SHARED_STYLE,
          position:  'relative',
          display:   'block',
          width:     '100%',
          height:    '100%',
          minHeight,
          color:     'transparent',
          caretColor: 'var(--color-text-1)',
          resize:    'none',
          background: 'transparent',
        }}
      />

      {/* Var tooltip — portaled to document.body to escape any CSS transform ancestor */}
      {tooltip && createPortal(
        <div
          role="tooltip"
          className={cn(
            'fixed z-[9999] px-2.5 py-1.5 rounded border shadow-lg pointer-events-none',
            'bg-surface-2 backdrop-blur-sm',
            TOOLTIP_BORDER[tooltip.type],
          )}
          style={{
            left:     Math.min(tooltip.x + 14, window.innerWidth - 320),
            top:      tooltip.y + 20,
            maxWidth: 360,
          }}
        >
          <div className="text-[9px] text-text-4 mb-0.5 leading-none">
            {`{{${tooltip.varName}}}`}
          </div>
          <div className={cn('text-[11px] font-mono leading-snug break-all', TOOLTIP_BORDER[tooltip.type])}>
            {tooltip.content}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
