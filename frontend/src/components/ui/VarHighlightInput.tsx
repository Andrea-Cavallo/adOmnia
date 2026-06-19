import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { uid } from '@/lib/types'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'

interface VarCandidate {
  name: string
  isVault: boolean
}

interface AutocompleteState {
  start: number
  query: string
  items: VarCandidate[]
  index: number
  x: number
  y: number
}

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

/** Pixel X (client coords) of the caret at the given character index. */
function caretXAtIndex(input: HTMLInputElement, charIdx: number): number {
  const ctx = getMeasureCtx()
  const rect = input.getBoundingClientRect()
  const cs = window.getComputedStyle(input)
  const paddingLeft = parseFloat(cs.paddingLeft) || 0
  if (!ctx) return rect.left + paddingLeft
  ctx.font = `${cs.fontSize} ${cs.fontFamily}`
  const width = ctx.measureText(input.value.slice(0, charIdx)).width
  return rect.left + paddingLeft + width - input.scrollLeft
}

/**
 * If the caret sits inside an unterminated `{{…` token, return the token's start
 * index and the partial query typed so far. Otherwise null.
 */
function openVarQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const open = before.lastIndexOf('{{')
  if (open === -1) return null
  const between = before.slice(open + 2)
  if (between.includes('}}') || between.includes('{{')) return null
  return { start: open, query: between.trim() }
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
  const showVaultInAutocomplete = useSettingsStore((s) => s.settings.vault.showVaultInAutocomplete)
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null)

  // Variable candidates for `{{ }}` autocomplete. Vault-backed variables (value
  // starts with `vault:`) are hidden unless the setting allows them.
  const varCandidates = useMemo<VarCandidate[]>(() => {
    return Object.entries(resolvedVars)
      .map(([name, val]) => ({ name, isVault: String(val).startsWith('vault:') }))
      .filter((c) => showVaultInAutocomplete || !c.isVault)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [resolvedVars, showVaultInAutocomplete])

  const refreshAutocomplete = useCallback(() => {
    const input = ref.current
    if (!input || varCandidates.length === 0) { setAutocomplete(null); return }
    const caret = input.selectionStart ?? input.value.length
    const open = openVarQueryAt(input.value, caret)
    if (!open) { setAutocomplete(null); return }
    const q = open.query.toLowerCase()
    const items = varCandidates
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const as = a.name.toLowerCase().startsWith(q) ? 0 : 1
        const bs = b.name.toLowerCase().startsWith(q) ? 0 : 1
        return as - bs || a.name.localeCompare(b.name)
      })
      .slice(0, 8)
    if (items.length === 0) { setAutocomplete(null); return }
    const rect = input.getBoundingClientRect()
    setAutocomplete((prev) => ({
      start: open.start,
      query: open.query,
      items,
      index: prev && prev.start === open.start ? Math.min(prev.index, items.length - 1) : 0,
      x: caretXAtIndex(input, open.start),
      y: rect.bottom,
    }))
  }, [ref, varCandidates])

  const acceptAutocomplete = useCallback((candidate: VarCandidate) => {
    const input = ref.current
    if (!input || !autocomplete) return
    const caret = input.selectionStart ?? input.value.length
    let tail = value.slice(caret)
    if (tail.startsWith('}}')) tail = tail.slice(2)
    const token = `{{${candidate.name}}}`
    const next = value.slice(0, autocomplete.start) + token + tail
    const newCaret = autocomplete.start + token.length
    onChange(next)
    setAutocomplete(null)
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus()
        ref.current.setSelectionRange(newCaret, newCaret)
      }
    })
  }, [ref, autocomplete, value, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (autocomplete && autocomplete.items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAutocomplete((a) => (a ? { ...a, index: (a.index + 1) % a.items.length } : a))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAutocomplete((a) => (a ? { ...a, index: (a.index - 1 + a.items.length) % a.items.length } : a))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        acceptAutocomplete(autocomplete.items[autocomplete.index])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAutocomplete(null)
        return
      }
    }
    onKeyDown?.(e)
  }, [autocomplete, acceptAutocomplete, onKeyDown])

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
    fontFamily:    'var(--font-mono)',
    fontSize:      '12px',
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
          requestAnimationFrame(() => { syncScroll(); refreshAutocomplete() })
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={syncScroll}
        onClick={() => { syncScroll(); refreshAutocomplete() }}
        onScroll={syncScroll}
        onBlur={() => window.setTimeout(() => setAutocomplete(null), 120)}
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

      {/* Variable autocomplete dropdown */}
      {autocomplete && createPortal(
        <div
          className="fixed z-[10000] min-w-[180px] max-w-[320px] overflow-hidden rounded-md border border-border-2 bg-surface-1 py-1 shadow-xl"
          style={{
            left: Math.min(autocomplete.x, window.innerWidth - 332),
            top: Math.min(autocomplete.y + 4, window.innerHeight - 200),
          }}
        >
          {autocomplete.items.map((item, i) => (
            <button
              key={item.name}
              // onMouseDown (not click) so it fires before the input's blur closes the menu.
              onMouseDown={(e) => { e.preventDefault(); acceptAutocomplete(item) }}
              onMouseEnter={() => setAutocomplete((a) => (a ? { ...a, index: i } : a))}
              className={cn(
                'flex w-full items-center gap-2 px-2.5 py-1 text-left font-mono text-[11px]',
                i === autocomplete.index ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {item.isVault && (
                <span className="shrink-0 rounded bg-warning/15 px-1 text-[8px] font-semibold uppercase tracking-wide text-warning">
                  vault
                </span>
              )}
            </button>
          ))}
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
