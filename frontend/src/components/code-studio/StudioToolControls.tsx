import { CodeStudioToolbarSelect } from './CodeStudioToolbarSelect'
import { ArrowDownToLine, ExternalLink, Maximize2, Minimize2 } from 'lucide-react'
import { bringBackTool, openStudioTool } from './studioToolBridge'
import { placeTool, toolContext, toolKey, useStudioTools, type StudioTool, type ToolPlacement } from './studioToolState'

export function StudioToolControls({ session, tool, defaultPlacement = 'bottom' }: { session: string; tool: StudioTool; defaultPlacement?: ToolPlacement }) {
  const key = toolKey(session, tool)
  const maximized = useStudioTools((state) => state.maximized === key)
  const placement = useStudioTools((state) => state.placements[key] ?? defaultPlacement)
  const detached = !!toolContext()
  return <div className="flex shrink-0 items-center gap-1">
    {detached ? <button type="button" className="code-studio-icon-button h-7 w-7" title="Bring back to project" aria-label="Bring back to project" onClick={() => void bringBackTool(session, tool)}><ArrowDownToLine size={14} /></button> : <>
      <CodeStudioToolbarSelect label="Tool position" value={placement}
        options={[{ value: 'bottom', label: 'Bottom' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
        onChange={(value) => placeTool(key, value as ToolPlacement)} />
      <button type="button" className="code-studio-icon-button h-7 w-7" title={maximized ? 'Restore tool size' : 'Maximize tool'} aria-label={maximized ? 'Restore tool size' : 'Maximize tool'} onClick={() => useStudioTools.setState({ maximized: maximized ? null : key })}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      <button type="button" className="code-studio-icon-button h-7 w-7" title="Open tool in separate window" aria-label="Open tool in separate window" onClick={() => void openStudioTool(session, tool)}><ExternalLink size={14} /></button>
    </>}
  </div>
}
