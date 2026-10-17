import { useState } from 'react'
import { FileCode2, Package } from 'lucide-react'
import type { GoIDESession } from '@/lib/code-studio-api'
import { CodeStudioCodeSecurityView } from './CodeStudioCodeSecurityView'
import { CodeStudioVulnPanel } from './CodeStudioVulnPanel'
import { VizSegmented } from './CodeStudioVizKit'

type SecurityTab = 'code' | 'dependencies'

const TABS = [
  { id: 'code' as const, label: 'Code', icon: FileCode2 },
  { id: 'dependencies' as const, label: 'Dependencies', icon: Package },
]

/** Security Studio: analisi offline del codice e vulnerabilità note delle dipendenze, nello stesso pannello. */
export function CodeStudioSecurityPanel({ session }: { session: GoIDESession }) {
  const [tab, setTab] = useState<SecurityTab>('code')
  const lead = <><span className="code-studio-tool-title">Security</span><VizSegmented label="Security views" value={tab} onChange={setTab} segments={TABS} /></>
  // Entrambe restano montate: cambiare scheda non perde scansioni e selezioni.
  return (
    <div className="h-full min-h-0">
      <div className={tab === 'code' ? 'h-full' : 'hidden'}><CodeStudioCodeSecurityView session={session} lead={lead} /></div>
      <div className={tab === 'dependencies' ? 'h-full' : 'hidden'}><CodeStudioVulnPanel session={session} lead={lead} /></div>
    </div>
  )
}
