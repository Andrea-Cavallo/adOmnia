import React from 'react'
import { cn } from '@/lib/utils'

interface ResizeHandleProps {
  /** Accessible label, also surfaced as the tooltip. */
  label: string
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  /**
   * Draw the centered hairline divider at rest. Defaults to `true`.
   * Set to `false` when an adjacent element already provides a 1px border,
   * so the divider does not render twice.
   */
  withLine?: boolean
  /** `vertical` separates side-by-side panes; `horizontal` separates stacked panes. */
  orientation?: 'vertical' | 'horizontal'
  className?: string
}

/**
 * Shared vertical column resize handle used across every multi-column surface
 * (API Workspace, Markdown Notes, LaTeX Studio, Mermaid Diagrams, sidebar split).
 *
 * Renders a thin divider with a centered 5-dot grip so the resize affordance is
 * pixel-for-pixel identical everywhere in adOmnia — one application, one language.
 */
export function ResizeHandle({ label, onMouseDown, withLine = true, orientation = 'vertical', className }: ResizeHandleProps) {
  const isVertical = orientation === 'vertical'
  return (
    <div
      role="separator"
      aria-label={label}
      title={label}
      onMouseDown={onMouseDown}
      className={cn(
        'group relative z-10 flex shrink-0 items-center justify-center bg-surface-0 transition-colors hover:bg-accent/[0.08]',
        isVertical ? 'w-[8px] cursor-ew-resize' : 'h-[8px] cursor-ns-resize',
        className,
      )}
    >
      {withLine && (
        <div className={cn(
          'absolute bg-border-1 transition-colors group-hover:bg-accent/55',
          isVertical ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
        )} />
      )}
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
    </div>
  )
}
