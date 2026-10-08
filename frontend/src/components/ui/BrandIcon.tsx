import { memo, type CSSProperties } from 'react'
import { BRAND_ICONS, type BrandIconSlug } from '@/lib/brandIcons.generated'
import { brandColors } from '@/lib/brandColors'

/**
 * Brand logo (Simple Icons, 24×24) in the brand color readable on the active
 * theme. `mono` draws it in the current text color, e.g. on an accent fill.
 */
export const BrandIcon = memo(function BrandIcon({ slug, size = 14, dimmed = false, mono = false }: { slug: BrandIconSlug; size?: number; dimmed?: boolean; mono?: boolean }) {
  const icon = BRAND_ICONS[slug]
  const colors = brandColors(icon.hex)
  const style = (mono ? { fill: 'currentColor' } : { '--brand-on-dark': colors.onDark, '--brand-on-light': colors.onLight }) as CSSProperties
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={style} className={`brand-icon shrink-0 ${mono ? '' : 'text-text-2'} ${dimmed ? 'opacity-55' : ''}`} role="img" aria-label={icon.title}>
      <path d={icon.path} />
    </svg>
  )
})
