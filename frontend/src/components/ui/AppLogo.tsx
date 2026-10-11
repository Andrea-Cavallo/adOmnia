import type { CSSProperties } from 'react'
import { useAppIcon } from '@/lib/brandAssets'

/** Monochrome artwork uses the live palette, while custom skin artwork is retained. */
export function AppLogo({ className, decorative = false }: { className?: string; decorative?: boolean }) {
  const icon = useAppIcon()
  if (icon === '/icon-white.png' || icon === '/icon-black.png') {
    const style: CSSProperties = {
      display: 'block', backgroundColor: 'var(--color-accent)',
      mask: `url(${icon}) center / contain no-repeat`,
      WebkitMask: `url(${icon}) center / contain no-repeat`,
    }
    return <span className={className} style={style} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'adOmnia'} aria-hidden={decorative || undefined} data-brand-mark />
  }
  return <img src={icon} alt={decorative ? '' : 'adOmnia'} className={className} data-brand-mark data-palette-logo />
}
