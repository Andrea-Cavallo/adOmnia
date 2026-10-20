import { useId } from 'react'
import type { HubLogoStyle } from './hubLayout'
import pixelWordmark from './assets/adomnia-pixel-wordmark.png'
import '@fontsource/geist/latin-800.css'

// Static adOmnia wordmark: the hexagonal mark (assets/images/adomnia-mark.svg) is the "o".
// Ink and glow come from the hub tokens, so it follows every palette; no WebGL, no animation.
export function HubLogo({ variant = 'classic' }: { variant?: HubLogoStyle }) {
  const id = useId().replace(/:/g, '')
  if (variant === 'pixel') return <div className="hub-logo hub-logo-pixel" role="img" aria-label="adOmnia">
    <svg viewBox="440 325 790 225" aria-hidden="true" focusable="false">
      <defs>
        <filter id={`${id}-ink`} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .2126 .7152 .0722 0 0" />
          <feComponentTransfer><feFuncA type="linear" slope="4" intercept="-.4" /></feComponentTransfer>
        </filter>
        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="440" y="325" width="790" height="225" style={{ maskType: 'alpha' }}>
          <image href={pixelWordmark} x="0" y="0" width="1672" height="941" filter={`url(#${id}-ink)`} />
        </mask>
        <linearGradient id={`${id}-palette`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--hub-accent)' }} />
          <stop offset=".5" style={{ stopColor: 'color-mix(in srgb, var(--hub-accent) 65%, var(--hub-ink))' }} />
          <stop offset="1" style={{ stopColor: 'var(--hub-accent)' }} />
        </linearGradient>
      </defs>
      <rect x="440" y="325" width="790" height="225" fill={`url(#${id}-palette)`} mask={`url(#${id}-mask)`} />
    </svg>
  </div>
  return <div className="hub-logo" aria-label="adOmnia">
    <span aria-hidden="true">ad</span>
    <svg viewBox="80 64 352 382" aria-hidden="true">
      <defs>
        <linearGradient id="hub-logo-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset=".35" style={{ stopColor: 'var(--hub-ink)' }}/>
          <stop offset="1" style={{ stopColor: 'var(--hub-accent)' }}/>
        </linearGradient>
      </defs>
      <g fill="url(#hub-logo-fill)">
        <path d="M256 68 420 162Q428 167 428 177V331Q428 341 419 346L274 433 295 365 372 320V194L256 127 140 194V320L250 365V442L94 351Q84 345 84 334V177Q84 167 93 162Z"/>
        <path d="M158 226Q215 228 239 286Q184 285 158 226ZM354 226Q297 228 273 286Q328 285 354 226Z"/>
      </g>
    </svg>
    <span aria-hidden="true">mnia</span>
  </div>
}
