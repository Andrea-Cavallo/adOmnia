import { useState } from 'react'
import { LayoutTemplate, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TemplateMarketplace } from './TemplateMarketplace'
import { InstallPanel } from '@/components/apis/InstallPanel'

type WorkspaceTab = 'templates' | 'apis'

interface TabButtonProps {
  active: boolean
  icon: React.ElementType
  label: string
  onClick: () => void
}

function TabButton({ active, icon: Icon, label, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
        active
          ? 'bg-surface-2 text-text-1 shadow-sm'
          : 'text-text-3 hover:text-text-1 hover:bg-surface-1',
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

/**
 * Unified Templates surface. Hosts both the curated template marketplace and the
 * installable public-API catalog behind a single rail entry so the two stay in
 * one coherent place instead of competing top-level items.
 */
export function TemplatesWorkspace() {
  const [tab, setTab] = useState<WorkspaceTab>('templates')

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      <div className="flex items-center gap-1 border-b border-border-1 px-3 py-2 flex-shrink-0">
        <TabButton
          active={tab === 'templates'}
          icon={LayoutTemplate}
          label="Templates"
          onClick={() => setTab('templates')}
        />
        <TabButton
          active={tab === 'apis'}
          icon={Package}
          label="Public APIs"
          onClick={() => setTab('apis')}
        />
      </div>
      <div className="flex-1 flex min-h-0">
        {tab === 'templates' ? <TemplateMarketplace /> : <InstallPanel />}
      </div>
    </div>
  )
}
