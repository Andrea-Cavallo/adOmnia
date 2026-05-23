import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface VarHighlightInputProps {
  value: string
  onChange: (v: string) => void
  resolvedVars: Record<string, string>
  hasActiveEnv: boolean
  placeholder?: string
  className?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  inputRef?: React.RefObject<HTMLInputElement>
}

type Segment = { text: string; type: 'plain' | 'resolved' | 'missing' | 'noenv' }

interface VarTooltip {
  varName: string
  content: string
  type: 'resolved' | 'missing' | 'empty' | 'noenv'
  x: number
  y: number
}

// ─── Canvas-based text measurement ───────────────────────────────────────────

let _ctx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_ctx) {
    try { _ctx = document.createElement('canvas').getContext('2d') } catch { /* not available */ }
  }
  return _ctx
}

/**
 * Returns the character index in `input.value` that sits under the given
 * clientX mouse coordinate, accounting for padding and horizontal scroll.
 */
function charIndexAtX(input: HTMLInputElement, clientX: number): number {
  const ctx = getMeasureCtx()
  if (!ctx) return 0
  const rect = input.getBoundingClientRect()
  const cs = window.getComputedStyle(input)
  ctx.font = `${cs.fontSize} ${cs.fontFamily}`
  const paddingLeft = parseFloat(cs.paddingLeft) || 0
  const relX = clientX - rect.left - paddingLeft + input.scrollLeft
  const text = input.value
  let accumulated = 0
  for (let i = 0; i < text.length; i++) {
    const cw = ctx.measureText(text[i]).width
    if (relX < accumulated + cw / 2) return i
    accumulated += cw
  }
  return text.length
}

// ─── Segment parsing ──────────────────────────────────────────────────────────

function parseSegments(
  text: string,
  resolvedVars: Record<string, string>,
  hasActiveEnv: boolean,
): Segment[] {
  const segments: Segment[] = []
  const re = /\{\{([^}]+)\}\}/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), type: 'plain' })
    const varName = m[1].trim()
    if (!hasActiveEnv) {
      segments.push({ text: m[0], type: 'noenv' })
    } else if (varName in resolvedVars && resolvedVars[varName] !== '') {
      segments.push({ text: m[0], type: 'resolved' })
    } else {
      segments.push({ text: m[0], type: 'missing' })
    }
    last = m.index + m[0].length
  }

  if (last < text.length) segments.push({ text: text.slice(last), type: 'plain' })
  return segments
}

const TYPE_STYLE: Record<Segment['type'], string> = {
  plain:    'color: inherit',
  resolved: 'color: var(--color-success); background: rgba(106,191,105,0.12); border-radius: 2px',
  missing:  'color: var(--color-error);   background: rgba(239,68,68,0.10);    border-radius: 2px',
  noenv:    'color: var(--color-warning);  background: rgba(234,179,8,0.10);   border-radius: 2px',
}

function buildHtml(segments: Segment[]): string {
  return segments
    .map(({ text, type }) => {
      const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<span style="${TYPE_STYLE[type]}">${esc}</span>`
    })
    .join('')
}

// ─── Tooltip logic ────────────────────────────────────────────────────────────

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
      if (!hasActiveEnv) {
        return { varName, content: 'No active environment', type: 'noenv' }
      }
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

// ─── Tooltip styling ──────────────────────────────────────────────────────────

const TOOLTIP_BORDER: Record<VarTooltip['type'], string> = {
  resolved: 'border-success/40 text-success',
  missing:  'border-error/40  text-error',
  empty:    'border-warning/40 text-warning',
  noenv:    'border-warning/40 text-warning',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VarHighlightInput({
  value,
  onChange,
  resolvedVars,
  hasActiveEnv,
  placeholder,
  className,
  onKeyDown,
  inputRef: externalRef,
}: VarHighlightInputProps) {
  const internalRef = useRef<HTMLInputElement>(null)
  const ref = externalRef ?? internalRef
  const [tooltip, setTooltip] = useState<VarTooltip | null>(null)

  const segments  = parseSegments(value, resolvedVars, hasActiveEnv)
  const overlayHtml = buildHtml(segments)

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      if (!ref.current) return
      const idx = charIndexAtX(ref.current, e.clientX)
      const tip = resolveVarTooltip(value, resolvedVars, hasActiveEnv, idx)
      if (tip) {
        setTooltip({ ...tip, x: e.clientX, y: e.clientY })
      } else {
        setTooltip(null)
      }
    },
    [ref, value, resolvedVars, hasActiveEnv],
  )

  const SHARED: React.CSSProperties = {
    fontFamily:    'var(--font-ui, var(--font-sans))',
    fontSize:      '13px',
    lineHeight:    '1.5',
    padding:       '0 8px',
    letterSpacing: 'normal',
    whiteSpace:    'pre',
    overflow:      'hidden',
    height:        '100%',
    width:         '100%',
  }

  return (
    <div className={cn('relative', className)}>
      {/* Colour-highlight overlay (aria-hidden, pointer-events-none) */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none overflow-hidden flex items-center"
        style={{ ...SHARED, color: 'var(--color-text-1)' }}
        dangerouslySetInnerHTML={{
          __html: overlayHtml ||
            `<span style="color:var(--color-text-4)">${placeholder ?? ''}</span>`,
        }}
      />

      {/* Real input — text is transparent so only the overlay colours show */}
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="relative w-full h-full bg-transparent text-transparent caret-text-1 outline-none placeholder:text-text-4"
        style={SHARED}
      />

      {/* Floating tooltip — portaled to document.body to escape any CSS transform ancestor */}
      {tooltip && createPortal(
        <div
          role="tooltip"
          className={cn(
            'fixed z-[9999] px-2.5 py-1.5 rounded border shadow-lg pointer-events-none',
            'bg-surface-2 backdrop-blur-sm',
            TOOLTIP_BORDER[tooltip.type],
          )}
          style={{
            left: Math.min(tooltip.x + 14, window.innerWidth - 320),
            top:  tooltip.y + 20,
            maxWidth: 360,
          }}
        >
          {/* Variable name header */}
          <div className="text-[9px] text-text-4 mb-0.5 leading-none">
            {`{{${tooltip.varName}}}`}
          </div>
          {/* Resolved value / status */}
          <div className={cn(
            'text-[11px] font-mono leading-snug break-all',
            TOOLTIP_BORDER[tooltip.type],
          )}>
            {tooltip.content}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
