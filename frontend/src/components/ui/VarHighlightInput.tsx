import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { uid } from '@/lib/types'
import { useEnvironmentsStore } from '@/stores/environments'

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

interface VarEditPopover {
  varName: string
  value: string
  exists: boolean
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

function varNameAtIndex(text: string, charIdx: number): string | null {
  const re = /\{\{([^}]+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (charIdx >= m.index && charIdx <= m.index + m[0].length) {
      return m[1].trim()
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
  const popoverRef = useRef<HTMLDivElement>(null)
  const ref = externalRef ?? internalRef
  const [tooltip, setTooltip] = useState<VarTooltip | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [editPopover, setEditPopover] = useState<VarEditPopover | null>(null)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const environments = useEnvironmentsStore((s) => s.environments)
  const updateVariables = useEnvironmentsStore((s) => s.updateVariables)

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

  const syncScroll = useCallback(() => {
    if (!ref.current) return
    setScrollLeft(ref.current.scrollLeft)
  }, [ref])

  const activeEnv = activeEnvId ? environments.find((env) => env.id === activeEnvId) : null

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      if (!ref.current || !activeEnv) return
      const varName = varNameAtIndex(value, charIndexAtX(ref.current, e.clientX))
      if (!varName) return

      e.preventDefault()
      setTooltip(null)
      const existing = activeEnv.variables.find((variable) => variable.key === varName)
      setEditPopover({
        varName,
        value: existing?.value ?? '',
        exists: Boolean(existing),
        x: e.clientX,
        y: e.clientY,
      })
    },
    [activeEnv, ref, value],
  )

  const saveVariableEdit = useCallback(() => {
    if (!activeEnv || !editPopover) return
    const nextVariables = activeEnv.variables.some((variable) => variable.key === editPopover.varName)
      ? activeEnv.variables.map((variable) => (
          variable.key === editPopover.varName
            ? { ...variable, value: editPopover.value }
            : variable
        ))
      : [
          ...activeEnv.variables,
          { id: uid(), key: editPopover.varName, value: editPopover.value, enabled: true },
        ]

    updateVariables(activeEnv.id, nextVariables)
    setEditPopover(null)
    requestAnimationFrame(() => ref.current?.focus())
  }, [activeEnv, editPopover, ref, updateVariables])

  useEffect(() => {
    if (!editPopover) return
    const handlePointerDown = (event: MouseEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) return
      setEditPopover(null)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [editPopover])

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
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ ...SHARED, color: 'var(--color-text-1)' }}
      >
        <div
          className="flex h-full min-w-max items-center"
          style={{ transform: `translateX(${-scrollLeft}px)` }}
          dangerouslySetInnerHTML={{
            __html: overlayHtml ||
              `<span style="color:var(--color-text-4)">${placeholder ?? ''}</span>`,
          }}
        />
      </div>

      {/* Real input — text is transparent so only the overlay colours show */}
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          requestAnimationFrame(syncScroll)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncScroll}
        onClick={syncScroll}
        onScroll={syncScroll}
        onContextMenu={handleContextMenu}
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

      {editPopover && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[10000] w-80 rounded-md border border-border-2 bg-surface-1 p-2 shadow-xl"
          style={{
            left: Math.min(editPopover.x, window.innerWidth - 336),
            top: Math.min(editPopover.y + 8, window.innerHeight - 136),
          }}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-accent">
              {`{{${editPopover.varName}}}`}
            </span>
            <span className="text-[9px] uppercase tracking-wide text-text-4">
              {editPopover.exists ? 'Edit env' : 'Create env'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={editPopover.value}
              onChange={(event) => setEditPopover((current) => current ? { ...current, value: event.target.value } : current)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveVariableEdit()
                if (event.key === 'Escape') setEditPopover(null)
              }}
              placeholder="Environment value"
              className="h-7 min-w-0 flex-1 rounded border border-border-2 bg-surface-2 px-2 font-mono text-xs text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
            />
            <button
              onClick={saveVariableEdit}
              className="h-7 rounded bg-accent px-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Save
            </button>
          </div>
          <div className="mt-1.5 truncate text-[10px] text-text-4">
            {activeEnv?.name ?? 'Active environment'}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
