import { CircleDot } from 'lucide-react'
import { FEATURE_ICONS } from './Rail'
import type { RailItem } from '@/stores/app'

export function TileIcon({ target }: { target: RailItem }) {
  if (['goide', 'collections', 'database', 'jsonviewer', 'powertools'].includes(target)) return <StudioIcon target={target}/>
  const Icon = FEATURE_ICONS[target] ?? CircleDot
  return <Icon size={40} strokeWidth={1.2}/>
}

function StudioIcon({ target }: { target: string }) {
  return <svg className="hub-glyph" viewBox="0 0 64 64" width="58" height="58" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      {target === 'goide' && <>
        <path d="M22 18L8 32l14 14M42 18l14 14-14 14"/>
        <path d="M37 12L27 52" strokeDasharray=".1 5" strokeWidth="3.5"/>
      </>}
      {target === 'collections' && <>
        <path d="M8 23a17 17 0 0 1 25-12M36 17v18M38 45a17 17 0 0 0 21-4"/>
        <path d="M5 29v8M60 34v4" strokeDasharray=".1 6" strokeWidth="3.5"/>
        <circle cx="5" cy="39" r="2.5" fill="currentColor" stroke="none"/>
        <circle className="hub-glyph-terminal" cx="60" cy="27" r="2.8" stroke="none"/>
      </>}
      {target === 'database' && <>
        <path d="M27 9C6 9 1 23 25 25M34 9c21 0 26 14 2 16M6 31c0 7 9 11 19 11M49 31c0 7-7 11-13 11M6 47c0 7 9 11 19 11M49 47c0 7-7 11-13 11"/>
        {[29, 40, 51].map(y => <circle key={y} cx="59" cy={y} r="2.3" fill="currentColor" stroke="none"/>)}
      </>}
      {target === 'jsonviewer' && <>
        <path d="M10 20l28 9v29l-28-9zM23 20v-6l28 9v29M36 14V8l24 8v29"/>
        {[19, 25, 31].flatMap(x => [35, 42].map(y => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="currentColor" stroke="none"/>))}
      </>}
      {target === 'powertools' && <>
        <path d="M21 8h7M36 8h7M49 13l11 18M58 39L47 56M39 59h-7M24 59h-7M12 53L3 37M5 28l10-16"/>
        <circle cx="32" cy="33" r="3.5" fill="currentColor" stroke="none"/>
      </>}
    </g>
  </svg>
}
