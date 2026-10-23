import React from 'react'
import { cn } from '@/lib/utils'

export interface ResizeHandleProps {
  /** Accessible label, also surfaced as the tooltip. */
  label: string
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  /**
   * Draw the centered hairline divider at rest. Defaults to `true`.
   * Set to `false` when an adjacent element already provides a 1px border,
   * so the divider does not render twice. Ignored by the `splitter` variant,
   * which always draws its own 2px line.
   */
  withLine?: boolean
  /** `vertical` separates side-by-side panes; `horizontal` separates stacked panes. */
  orientation?: 'vertical' | 'horizontal'
  className?: string
  /**
   * `splitter` is the divider between Code Studio islands: 10px hit area straddling
   * the island border and a 2px line that stays visible at rest in every skin.
   * `default` keeps the classic centered hairline with the hover grip.
   */
  variant?: 'default' | 'splitter'
  /**
   * Keyboard resize. Receives the signed step in px: positive for the forward keys
   * (ArrowRight / ArrowDown), negative for the backward ones. Shift multiplies the
   * step. Supplying it makes the handle focusable; without it the handle is mouse-only.
   */
  onArrow?: (delta: number, event: React.KeyboardEvent<HTMLDivElement>) => void
  /** Double click: splitters use it to reset the dragged pane to its default size. */
  onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void
}

/** Mouse drag plus keyboard and double click, as handed out by the pane resize factory. */
export type ResizeHandleInteraction = Pick<ResizeHandleProps, 'onMouseDown' | 'onArrow' | 'onDoubleClick'>

const KEY_STEP = 8
const KEY_STEP_LARGE = 32

/**
 * Shared vertical column resize handle used across every multi-column surface
 * (API Workspace, Markdown Notes, LaTeX Studio, Mermaid Diagrams, sidebar split).
 *
 * Renders a thin divider with a centered 5-dot grip so the resize affordance is
 * pixel-for-pixel identical everywhere in adOmnia — one application, one language.
 */
export function ResizeHandle({ label, onMouseDown, withLine = true, orientation = 'vertical', className, variant = 'default', onArrow, onDoubleClick }: ResizeHandleProps) {
  const isVertical = orientation === 'vertical'
  const splitter = variant === 'splitter'
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onArrow) return
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    if (event.key === (isVertical ? 'ArrowRight' : 'ArrowDown')) {
      event.preventDefault()
      onArrow(step, event)
      return
    }
    if (event.key === (isVertical ? 'ArrowLeft' : 'ArrowUp')) {
      event.preventDefault()
      onArrow(-step, event)
    }
  }
  // A focusable separator is the ARIA APG window-splitter pattern: the keyboard target only exists
  // when the arrow keys actually resize, so the tabindex follows `onArrow`. Sonar's S6845 treats
  // role="separator" as non-interactive and would drop the only keyboard path to the splitter.
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      title={label}
      tabIndex={onArrow ? 0 : undefined} // NOSONAR -- see above
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative z-10 flex shrink-0 items-center justify-center transition-colors',
        splitter ? 'bg-transparent hover:bg-transparent' : 'bg-surface-0 hover:bg-accent/[0.08]',
        isVertical ? 'cursor-ew-resize' : 'cursor-ns-resize',
        isVertical ? (splitter ? 'w-[10px]' : 'w-[8px]') : (splitter ? 'h-[10px]' : 'h-[8px]'),
        splitter && 'code-studio-splitter',
        className,
      )}
    >
      {withLine && !splitter && (
        <div className={cn(
          // --color-divider is derived from the active theme: the same hairline stays
          // visible on dark skins where --color-border-1 blends into the background.
          'absolute bg-[var(--color-divider,var(--color-border-1))] transition-colors group-hover:bg-accent/55',
          isVertical ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
        )} />
      )}
      {!splitter && (
        <>
          <div className={cn(
            'absolute rounded-full bg-accent/0 shadow-none transition-all group-hover:bg-accent/16 group-hover:shadow-[0_0_14px_var(--color-accent-glow)]',
            isVertical ? 'inset-y-2 left-1/2 w-[3px] -translate-x-1/2' : 'inset-x-2 top-1/2 h-[3px] -translate-y-1/2',
          )} />
          <div className={cn('relative flex items-center gap-[3px] opacity-0 transition-all group-hover:scale-100 group-hover:opacity-95 scale-95', isVertical ? 'flex-col' : 'flex-row')}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-[3px] w-[3px] rounded-full bg-accent transition-colors"
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
