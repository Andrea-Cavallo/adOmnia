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
  className?: string
}

/**
 * Shared vertical column resize handle used across every multi-column surface
 * (API Workspace, Markdown Notes, LaTeX Studio, Mermaid Diagrams, sidebar split).
 *
 * Renders a thin divider with a centered 5-dot grip so the resize affordance is
 * pixel-for-pixel identical everywhere in adOmnia — one application, one language.
 */
export function ResizeHandle({ label, onMouseDown, withLine = true, className }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-label={label}
      title={label}
      onMouseDown={onMouseDown}
      className={cn(
        'group relative z-10 flex w-[6px] shrink-0 cursor-ew-resize items-center justify-center bg-surface-0 transition-colors hover:bg-accent/10',
        className,
      )}
    >
      {withLine && (
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-1 transition-colors group-hover:bg-accent/50" />
      )}
      <div className="relative flex flex-col items-center gap-[3px] opacity-40 transition-opacity group-hover:opacity-90">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-[3px] w-[3px] rounded-full bg-text-3 transition-colors group-hover:bg-accent"
          />
        ))}
      </div>
    </div>
  )
}
