import type { ReactNode } from 'react'
import { PanelLeft, PanelRight } from 'lucide-react'
import { CodeStudioChromeDisclosure } from './CodeStudioChromeDisclosure'

export function CodeStudioToolDrawer({ side, children }: { side: 'left' | 'right'; children: ReactNode }) {
  const Icon = side === 'left' ? PanelLeft : PanelRight
  const label = side === 'left' ? 'Tool windows' : 'Assistant and project tools'
  return (
    <CodeStudioChromeDisclosure className={`code-studio-tool-drawer code-studio-tool-drawer-${side}`} label={label} icon={<Icon size={15}/> }>
      <div className="code-studio-tool-drawer-content">{children}</div>
    </CodeStudioChromeDisclosure>
  )
}
