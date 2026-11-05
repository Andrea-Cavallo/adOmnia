import { ChevronRight } from 'lucide-react'

export const ROW_INDENT_PX = 16
export const ROW_BASE_PX = 6
/** Consistent icon slots keep folder and file labels aligned. */
export const TREE_ICON_PX = 16

/** Chevron unico che ruota all'apertura, come nella sidebar delle collection. */
export function TreeChevron({ open }: { open: boolean }) {
  return <ChevronRight size={12} aria-hidden="true" className={`shrink-0 text-text-4 transition-transform duration-100 ${open ? 'rotate-90' : ''}`} />
}
