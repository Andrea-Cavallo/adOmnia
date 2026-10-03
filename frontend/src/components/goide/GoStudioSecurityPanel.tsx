import { useState } from 'react'
import { FileCode2, Package } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { GoStudioCodeSecurityView } from './GoStudioCodeSecurityView'
import { GoStudioVulnPanel } from './GoStudioVulnPanel'
import { VizSegmented } from './GoStudioVizKit'

type SecurityTab = 'code' | 'dependencies'

const TABS = [
  { id: 'code' as const, label: 'Code', icon: FileCode2 },
  { id: 'dependencies' as const, label: 'Dependencies', icon: Package },
]

/** Security Studio: analisi offline del codice e vulnerabilità note delle dipendenze, nello stesso pannello. */
export function GoStudioSecurityPanel({ session }: { session: GoIDESession }) {
  const [tab, setTab] = useState<SecurityTab>('code')
  const lead = <><span className="go-studio-tool-title">Security</span><VizSegmented label="Security views" value={tab} onChange={setTab} segments={TABS} /></>
  // Entrambe restano montate: cambiare scheda non perde scansioni e selezioni.
  return (
    <div className="h-full min-h-0">
      <div className={tab === 'code' ? 'h-full' : 'hidden'}><GoStudioCodeSecurityView session={session} lead={lead} /></div>
      <div className={tab === 'dependencies' ? 'h-full' : 'hidden'}><GoStudioVulnPanel session={session} lead={lead} /></div>
    </div>
  )
}
