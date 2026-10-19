import './HubHalloween.css'

// Temporary Hub edition. Set false to restore the standard Hub; no saved settings change.
export const HALLOWEEN_HUB_ENABLED = true

/** Static Glyph artwork: local SVG, no timers, canvas, downloads or extra fonts. */
export function HubHalloween() {
  return <div className="hub-halloween-scene" aria-hidden="true">
    <svg viewBox="0 0 360 210" focusable="false">
      <defs>
        <pattern id="hub-halloween-dots" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="3.5" cy="3.5" r="1.6" fill="currentColor"/>
        </pattern>
        <mask id="hub-halloween-face">
          <rect width="360" height="210" fill="white"/>
          <path d="m124 92 39 13-26 13zm112 0-39 13 26 13zM148 143l16 6 9-8 8 11 12-11 8 8 15-6-10 22h-46z" fill="black"/>
        </mask>
      </defs>
      <g className="hub-halloween-orbit" fill="none" stroke="currentColor" strokeWidth=".6">
        <ellipse cx="180" cy="116" rx="143" ry="76" strokeDasharray="1 7"/>
        <path d="M25 116h35m240 0h35M180 12v15m0 161v12"/>
        <circle cx="57" cy="77" r="3"/><circle cx="302" cy="155" r="3"/>
      </g>
      <g fill="url(#hub-halloween-dots)" mask="url(#hub-halloween-face)">
        <path d="M177 61c-40-21-82 3-82 55 0 49 37 74 85 69 48 5 85-20 85-69 0-52-42-76-82-55z"/>
      </g>
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M179 63c-2-14 2-25 15-33l9 7c-12 4-17 12-17 24" strokeWidth="3"/>
        <path d="M161 64c-20 29-23 82-5 112m43-112c20 29 23 82 5 112" strokeWidth="1" opacity=".35"/>
        <path d="m48 39 9 5 9-5-3 10-6-3-6 3zm243 3 9 5 9-5-3 10-6-3-6 3z" strokeWidth="1.4"/>
      </g>
      <text x="22" y="193" className="hub-halloween-coordinate">31 / 10</text>
      <text x="338" y="193" textAnchor="end" className="hub-halloween-coordinate">ED. 026</text>
    </svg>
  </div>
}
