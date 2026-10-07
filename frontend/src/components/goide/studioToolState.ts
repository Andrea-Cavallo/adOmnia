import { create } from 'zustand'
import { useCallback, type SetStateAction } from 'react'

export const STUDIO_TOOLS = ['run', 'logs', 'terminal', 'copilot', 'milk'] as const
export type StudioTool = typeof STUDIO_TOOLS[number]
export type ToolPlacement = 'bottom' | 'left' | 'right'
export const toolTitle: Record<StudioTool, string> = { run: 'Run output', logs: 'Service logs', terminal: 'Terminal', copilot: 'Copilot Chat', milk: 'milk' }
export const toolKey = (session: string, tool: StudioTool) => `tool-${session}-${tool}`
export function toolContext(search = typeof window === 'undefined' ? '' : window.location.search) {
  const params = new URLSearchParams(search)
  const tool = params.get('tool') as StudioTool
  const session = params.get('session') ?? ''
  return params.get('window') === 'studio-tool' && /^[A-Za-z0-9_-]{1,80}$/.test(session) && STUDIO_TOOLS.includes(tool)
    ? { session, tool, key: toolKey(session, tool) } : null
}

type ViewValue = string | boolean | null
interface ToolState {
  detached: string[]
  error: string | null
  maximized: string | null
  placements: Record<string, ToolPlacement>
  views: Record<string, Record<string, ViewValue>>
}
const LAYOUT_KEY = 'adomnia.studio.toolLayout.v1'
function readPlacements(): Record<string, ToolPlacement> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([key, position]) => /^tool-[A-Za-z0-9_-]+-(run|logs|terminal|copilot|milk)$/.test(key) && ['bottom', 'left', 'right'].includes(position)))
  } catch { return {} }
}
export const useStudioTools = create<ToolState>(() => ({ detached: [], error: null, maximized: null, placements: readPlacements(), views: {} }))

let forwardView: ((key: string, name: string, value: ViewValue) => void) | null = null
export function setViewForwarder(forward: typeof forwardView) { forwardView = forward }
export function patchToolView(key: string, name: string, value: ViewValue) {
  useStudioTools.setState((state) => ({ views: { ...state.views, [key]: { ...state.views[key], [name]: value } } }))
  forwardView?.(key, name, value)
}
type Widen<T> = T extends string ? string : T extends boolean ? boolean : T
export function useToolView<T extends ViewValue>(session: string, tool: StudioTool, name: string, initial: T): [Widen<T>, (value: SetStateAction<Widen<T>>) => void] {
  const key = toolKey(session, tool)
  const value = useStudioTools((state) => (state.views[key]?.[name] ?? initial) as Widen<T>)
  const set = useCallback((next: SetStateAction<Widen<T>>) => {
    const current = (useStudioTools.getState().views[key]?.[name] ?? initial) as Widen<T>
    patchToolView(key, name, typeof next === 'function' ? next(current) : next)
  }, [key, name, initial])
  return [value, set]
}
export function placeTool(key: string, placement: ToolPlacement) {
  const placements = { ...useStudioTools.getState().placements, [key]: placement }
  useStudioTools.setState({ placements, maximized: null })
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(placements)) } catch { /* Layout stays usable in memory. */ }
}
