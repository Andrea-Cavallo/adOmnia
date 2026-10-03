import { useCallback, useState, type ReactNode } from 'react'

const TOOLTIP_OFFSET_PX = 14
const TOOLTIP_MAX_WIDTH_PX = 360

export interface VizTooltipState {
  x: number
  y: number
  content: ReactNode
}

/** Tooltip dei grafici: segue il puntatore e si ribalta a sinistra vicino al bordo destro. */
export function useVizTooltip() {
  const [tooltip, setTooltip] = useState<VizTooltipState | null>(null)
  const show = useCallback((event: { clientX: number; clientY: number }, content: ReactNode) => {
    setTooltip({ x: event.clientX, y: event.clientY, content })
  }, [])
  const hide = useCallback(() => setTooltip(null), [])
  return { tooltip, show, hide }
}

export function VizTooltip({ tooltip }: { tooltip: VizTooltipState | null }) {
  if (!tooltip) return null
  const flip = tooltip.x + TOOLTIP_OFFSET_PX + TOOLTIP_MAX_WIDTH_PX > window.innerWidth
  const left = flip ? tooltip.x - TOOLTIP_OFFSET_PX - TOOLTIP_MAX_WIDTH_PX : tooltip.x + TOOLTIP_OFFSET_PX
  return (
    <div role="tooltip" className="go-studio-viz-tooltip" style={{ left: Math.max(8, left), top: tooltip.y + TOOLTIP_OFFSET_PX, width: flip ? TOOLTIP_MAX_WIDTH_PX : undefined }}>
      {tooltip.content}
    </div>
  )
}

/** Riga del tooltip: etichetta in inchiostro secondario, valore allineato a destra. */
export function VizTooltipRow({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      {color && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: color }} />}
      <span className="text-text-4">{label}</span>
      <span className="ml-auto pl-3 font-mono tabular-nums text-text-1">{value}</span>
    </div>
  )
}

export interface VizLegendItem {
  id: string
  label: string
  color: string
  /** Altezza relativa del segno (1 = piena): la traccia codifica lo stato anche con lo spessore. */
  thickness?: number
}

/** Legenda compatta: campione colorato + etichetta in inchiostro di testo, mai nel colore della serie. */
export function VizLegend({ items, trailing }: { items: VizLegendItem[]; trailing?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-3">
      {items.map((item) => (
        <span key={item.id} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="flex h-2.5 w-3 items-center">
            <span className="w-full rounded-[2px]" style={{ background: item.color, height: `${Math.round((item.thickness ?? 1) * 10)}px` }} />
          </span>
          {item.label}
        </span>
      ))}
      {trailing && <span className="ml-auto">{trailing}</span>}
    </div>
  )
}

/** Barra di magnitudine nelle tabelle: traccia neutra e riempimento nel colore dell'entità. */
export function VizBar({ value, max, color, width = 72 }: { value: number; max: number; color: string; width?: number }) {
  const percent = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0
  return (
    <span className="relative h-[6px] shrink-0 overflow-hidden rounded-full" style={{ width, background: 'var(--gs-viz-track)' }} aria-hidden="true">
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${percent}%`, background: color }} />
    </span>
  )
}

export interface VizSegment<T extends string> {
  id: T
  label: string
  icon?: React.ComponentType<{ size?: number }>
}

/** Controllo a segmenti per le viste di un pannello: pillola attiva sollevata, come i segmented control di macOS. */
export function VizSegmented<T extends string>({ segments, value, onChange, label }: { segments: Array<VizSegment<T>>; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex items-center gap-0.5 rounded-[10px] bg-[var(--gs-ground)] p-0.5">
      {segments.map(({ id, label: text, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`flex h-6 items-center gap-1.5 rounded-[8px] px-2.5 text-[11.5px] transition-colors ${value === id ? 'bg-[var(--gs-raised)] font-medium text-text-1 shadow-[0_1px_2px_rgb(0_0_0/0.18)]' : 'text-text-3 hover:text-text-1'}`}
        >
          {Icon && <Icon size={12} />}{text}
        </button>
      ))}
    </div>
  )
}
