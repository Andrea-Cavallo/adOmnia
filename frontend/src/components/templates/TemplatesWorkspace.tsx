import { LayoutTemplate } from 'lucide-react'
import { TemplateMarketplace } from './TemplateMarketplace'

/**
 * Curated template marketplace — import, customise and publish reusable
 * workspace templates directly from the desktop toolbox.
 */
export function TemplatesWorkspace() {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      <div className="flex items-center gap-1 border-b border-border-1 px-3 py-2 flex-shrink-0">
        <LayoutTemplate size={13} className="text-text-3" />
        <span className="text-[10px] font-bold text-text-3 uppercase tracking-widest">Templates</span>
      </div>
      <div className="flex-1 flex min-h-0">
        <TemplateMarketplace />
      </div>
    </div>
  )
}
