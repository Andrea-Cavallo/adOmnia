import { useRef, useState } from 'react'
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

function parseSegments(
  text: string,
  resolvedVars: Record<string, string>,
  hasActiveEnv: boolean
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
  plain: 'color: inherit',
  resolved: 'color: var(--color-success); background: rgba(106,191,105,0.12); border-radius: 2px',
  missing: 'color: var(--color-error); background: rgba(239,68,68,0.10); border-radius: 2px',
  noenv: 'color: var(--color-warning); background: rgba(234,179,8,0.10); border-radius: 2px',
}

function buildHtml(segments: Segment[]): string {
  return segments.map(({ text, type }) => {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<span style="${TYPE_STYLE[type]}">${escaped}</span>`
  }).join('')
}

function getTooltip(
  text: string,
  resolvedVars: Record<string, string>,
  hasActiveEnv: boolean,
  cursorPos: number
): string | null {
  const re = /\{\{([^}]+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (cursorPos >= m.index && cursorPos <= m.index + m[0].length) {
      const varName = m[1].trim()
      if (!hasActiveEnv) return '⚠ No active environment'
      if (varName in resolvedVars && resolvedVars[varName] !== '') return `= ${resolvedVars[varName]}`
      return '⚠ Not set'
    }
  }
  return null
}

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
  const [cursorPos, setCursorPos] = useState(0)
  const [showTooltip, setShowTooltip] = useState(false)

  const segments = parseSegments(value, resolvedVars, hasActiveEnv)
  const overlayHtml = buildHtml(segments)
  const tooltip = showTooltip ? getTooltip(value, resolvedVars, hasActiveEnv, cursorPos) : null

  const SHARED: React.CSSProperties = {
    fontFamily: 'var(--font-ui, var(--font-sans))',
    fontSize: '13px',
    lineHeight: '1.5',
    padding: '0 8px',
    letterSpacing: 'normal',
    whiteSpace: 'pre',
    overflow: 'hidden',
    height: '100%',
    width: '100%',
  }

  return (
    <div className={cn('relative', className)}>
      {/* Highlight overlay */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none overflow-hidden flex items-center"
        style={{ ...SHARED, color: 'var(--color-text-1)' }}
        dangerouslySetInnerHTML={{ __html: overlayHtml || `<span style="color:var(--color-text-4)">${placeholder ?? ''}</span>` }}
      />
      {/* Actual input */}
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onMouseMove={(e) => {
          setCursorPos(e.currentTarget.selectionStart ?? 0)
          setShowTooltip(true)
        }}
        onMouseLeave={() => setShowTooltip(false)}
        onSelect={(e) => setCursorPos(e.currentTarget.selectionStart ?? 0)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="relative w-full h-full bg-transparent text-transparent caret-text-1 outline-none placeholder:text-text-4"
        style={SHARED}
      />
      {tooltip && (
        <div className="absolute top-full left-0 mt-1 z-50 px-2 py-1 bg-surface-3 border border-border-2 rounded text-[10px] text-text-1 font-mono shadow-lg pointer-events-none whitespace-nowrap">
          {tooltip}
        </div>
      )}
    </div>
  )
}
