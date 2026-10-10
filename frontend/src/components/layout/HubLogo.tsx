import '@fontsource/geist/latin-800.css'

// Static adOmnia wordmark: the hexagonal mark (assets/images/adomnia-mark.svg) is the "o".
// Ink and glow come from the hub tokens, so it follows every palette; no WebGL, no animation.
export function HubLogo({ onClick }: { onClick?: () => void }) {
  return <button type="button" className="hub-logo" onClick={onClick} aria-label="adOmnia">
    <span aria-hidden="true">ad</span>
    <svg viewBox="80 64 352 382" aria-hidden="true">
      <defs>
        <linearGradient id="hub-logo-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset=".35" style={{ stopColor: 'var(--hub-ink)' }}/>
          <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--hub-accent) 55%, var(--hub-ink))' }}/>
        </linearGradient>
      </defs>
      <g fill="url(#hub-logo-fill)">
        <path d="M256 68 420 162Q428 167 428 177V331Q428 341 419 346L274 433 295 365 372 320V194L256 127 140 194V320L250 365V442L94 351Q84 345 84 334V177Q84 167 93 162Z"/>
        <path d="M158 226Q215 228 239 286Q184 285 158 226ZM354 226Q297 228 273 286Q328 285 354 226Z"/>
      </g>
    </svg>
    <span aria-hidden="true">mnia</span>
  </button>
}
