import { McpConnectionForm } from './McpConnectionForm'
import { McpHistoryPanel } from './McpHistoryPanel'
import { McpToolInspector } from './McpToolInspector'

export function McpPanel() {
  return (
    <div className="flex h-full overflow-hidden bg-surface-0">
      <McpConnectionForm />
      <McpToolInspector />
      <McpHistoryPanel />
    </div>
  )
}
