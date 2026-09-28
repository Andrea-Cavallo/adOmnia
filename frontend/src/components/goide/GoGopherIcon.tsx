interface GoGopherIconProps {
  size?: number
  className?: string
}

const BODY = '#7FD3E8'
const OUTLINE = '#2E6F80'
const MUZZLE = '#F2D6B3'
const PUPIL = '#16181D'

/**
 * Gopher Go semplificato per i file .go, leggibile fino a 12px.
 * Ispirato al Go gopher di Renée French (licenza Creative Commons Attribution 4.0).
 */
export function GoGopherIcon({ size = 13, className }: GoGopherIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={`shrink-0 ${className ?? ''}`} role="img" aria-label="Go file">
      <circle cx="7" cy="7" r="3.2" fill={BODY} stroke={OUTLINE} strokeWidth="1.3" />
      <circle cx="25" cy="7" r="3.2" fill={BODY} stroke={OUTLINE} strokeWidth="1.3" />
      <path d="M3.6 20.5c-1.6.4-1.9 2.4-.3 2.8M28.4 20.5c1.6.4 1.9 2.4.3 2.8" fill="none" stroke={OUTLINE} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M16 3.5c7.3 0 11 4.3 11 11.2v9.4c0 4.4-4.6 6.4-11 6.4s-11-2-11-6.4v-9.4C5 7.8 8.7 3.5 16 3.5z" fill={BODY} stroke={OUTLINE} strokeWidth="1.3" />
      <circle cx="10.9" cy="11.8" r="4.3" fill="#fff" stroke={OUTLINE} strokeWidth="0.9" />
      <circle cx="21.1" cy="11.8" r="4.3" fill="#fff" stroke={OUTLINE} strokeWidth="0.9" />
      <circle cx="12" cy="12.4" r="1.9" fill={PUPIL} />
      <circle cx="20" cy="12.4" r="1.9" fill={PUPIL} />
      <ellipse cx="16" cy="18.2" rx="3.6" ry="2.6" fill={MUZZLE} stroke={OUTLINE} strokeWidth="0.7" />
      <ellipse cx="16" cy="16.9" rx="1.6" ry="1.1" fill={PUPIL} />
      <rect x="14.8" y="20.3" width="2.4" height="2.4" rx="0.5" fill="#fff" stroke={OUTLINE} strokeWidth="0.6" />
    </svg>
  )
}

/** Vero per i sorgenti Go (non go.mod/go.sum/go.work). */
export function isGoSource(name: string): boolean {
  return name.toLowerCase().endsWith('.go')
}
