import { Events } from '@wailsio/runtime'
import * as AppBindings from '../../../bindings/adomnia/app'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDEWindowsStore } from '@/stores/goideWindows'
import { useMilkStore } from '@/stores/milk'
import { useClaudeCodeStore } from '@/stores/claudeCode'
import type { AgentChatStore } from '@/stores/agentChat'
import { useCopilotStore } from '@/stores/copilot'
import { useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { subscribeGoIDEEvents, listGoIDETerminals } from '@/lib/goide-api'
import { focusGoIDESessionWindow } from '@/lib/goide-window-api'
import { useGoIDETestsStore } from '@/stores/goideTests'
import { useAppStore } from '@/stores/app'
import { exportTerminalHistory, importTerminalHistory, startGoStudioTerminalBus } from './goStudioTerminalBus'
import { STUDIO_TOOLS, toolContext, toolKey, toolTitle, useStudioTools, patchToolView, setViewForwarder, type StudioTool } from './studioToolState'

const REQUEST = 'studio-tool:request'
const RESPONSE = 'studio-tool:response'
const SNAPSHOT = 'studio-tool:snapshot'
interface Request { session: string; tool: StudioTool; id: string; action: string; args: unknown[] }
type Snapshot = ReturnType<typeof snapshot>
/** ACP agent chats (internal/milk on the backend): same store shape, same forwarding. */
const agentStore = (tool: StudioTool): AgentChatStore | null => tool === 'milk' ? useMilkStore : tool === 'claude' ? useClaudeCodeStore : null
let ownerStarted = false
let clientStarted = false
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const optimisticViews = new Map<string, { value: string | boolean | null; revision: number }>()
let viewRevision = 0

function snapshot(sessionId: string, tool: StudioTool) {
  const ide = useGoIDEStore.getState()
  const session = ide.sessions.find((item) => item.id === sessionId)
  if (!session) return null
  const root = session.project.realPath
  const agent = agentStore(tool)?.getState()
  const copilot = useCopilotStore.getState()
  const assistant = useGoStudioAssistantStore.getState()
  const executions = ide.executions.filter((item) => item.sessionId === sessionId)
  const document = ide.documents.find((item) => item.document.id === ide.activeDocumentBySession[sessionId])
  return {
    key: toolKey(sessionId, tool), session,
    document: tool === 'copilot' || agent ? document ?? null : null,
    executions, activeRun: ide.activeRunBySession[sessionId],
    consoleByRun: tool === 'run' || tool === 'logs' ? Object.fromEntries(executions.map((run) => [run.id, ide.consoleByRun[run.id] ?? []])) : {},
    agent: agent ? { status: agent.status, settings: agent.settings, chatThreads: { [root]: agent.chatThreads[root] }, permissions: agent.permissions } : null,
    copilot: tool === 'copilot' ? { status: copilot.status, settings: copilot.settings, chatThreads: { [root]: copilot.chatThreads[root] }, chatModels: copilot.chatModels, chatModelsLoaded: copilot.chatModelsLoaded, chatModelsError: copilot.chatModelsError } : null,
    draft: assistant.pane === tool ? assistant.draft : null,
    terminalRequest: tool === 'terminal' ? useGoIDELspStore.getState().terminalRequest : null,
    view: useStudioTools.getState().views[toolKey(sessionId, tool)] ?? {},
  }
}

export async function openStudioTool(session: string, tool: StudioTool) {
  startStudioToolOwner()
  try {
    await AppBindings.OpenStudioToolWindow(session, tool, toolTitle[tool])
    useStudioTools.setState({ detached: await AppBindings.ListPanelWindows(), error: null, maximized: null })
  } catch (error) { useStudioTools.setState({ error: String(error) }) }
}
export async function bringBackTool(session: string, tool: StudioTool) { await AppBindings.CloseStudioToolWindow(session, tool) }
export async function selectToolRun(session: string, _tool: StudioTool, id: string) {
  if (toolContext()) return toolRequest('selectRun', [id])
  useGoIDEStore.setState((state) => ({ activeRunBySession: { ...state.activeRunBySession, [session]: id } }))
}

/** The project owner is the only writer of run/chat state; children are views. */
export function startStudioToolOwner() {
  if (ownerStarted || toolContext()) return
  ownerStarted = true
  startGoStudioTerminalBus()
  let timer: ReturnType<typeof setTimeout> | null = null
  const dirty = new Set<StudioTool>()
  const send = () => {
    timer = null
    const changed = new Set(dirty)
    dirty.clear()
    const tools = useStudioTools.getState().detached
    for (const session of useGoIDEStore.getState().sessions) {
      if (!useGoIDEWindowsStore.getState().ownsSession(session.id)) continue
      for (const tool of changed) if (tools.includes(toolKey(session.id, tool))) void Events.Emit(SNAPSHOT, snapshot(session.id, tool))
    }
  }
  const schedule = (tools: readonly StudioTool[]) => { tools.forEach((tool) => dirty.add(tool)); timer ??= setTimeout(send, 100) }
  // An AI token never retransmits a large Run buffer. Only changed tool
  // domains are refreshed, and high-volume output is batched at 100 ms.
  useGoIDEStore.subscribe((state, previous) => {
    if (state.sessions !== previous.sessions) schedule(STUDIO_TOOLS)
    if (state.executions !== previous.executions || state.consoleByRun !== previous.consoleByRun || state.activeRunBySession !== previous.activeRunBySession) schedule(['run', 'logs'])
    if (state.documents !== previous.documents || state.activeDocumentBySession !== previous.activeDocumentBySession) schedule(['copilot', 'milk', 'claude'])
  })
  useMilkStore.subscribe(() => schedule(['milk']))
  useClaudeCodeStore.subscribe(() => schedule(['claude']))
  useCopilotStore.subscribe(() => schedule(['copilot']))
  useGoStudioAssistantStore.subscribe(() => schedule(['milk', 'claude', 'copilot']))
  useGoIDELspStore.subscribe((state, previous) => { if (state.terminalRequest !== previous.terminalRequest) schedule(['terminal']) })
  useStudioTools.subscribe((state, previous) => {
    if (state.detached !== previous.detached) schedule(STUDIO_TOOLS)
    if (state.views !== previous.views) for (const tool of STUDIO_TOOLS) {
      if (Object.keys(state.views).some((key) => key.endsWith(`-${tool}`) && state.views[key] !== previous.views[key])) schedule([tool])
    }
  })
  Events.On('panelwindow:changed', (event) => {
    if (Array.isArray(event.data)) useStudioTools.setState({ detached: event.data })
  })
  void AppBindings.ListPanelWindows().then((detached) => useStudioTools.setState({ detached })).catch(() => undefined)
  Events.On(REQUEST, (event) => {
    const message = event.data as Request
    if (!message || !STUDIO_TOOLS.includes(message.tool) || !Array.isArray(message.args) || !useGoIDEWindowsStore.getState().ownsSession(message.session)) return
    const state = snapshot(message.session, message.tool)
    if (!state || !useStudioTools.getState().detached.includes(state.key)) return
    void (async () => {
      try {
        const result = await runOwnerAction(message, state)
        await Events.Emit(RESPONSE, { key: state.key, id: message.id, result })
        if (message.action === 'snapshot') await Events.Emit(SNAPSHOT, snapshot(message.session, message.tool))
      } catch (error) { await Events.Emit(RESPONSE, { key: state.key, id: message.id, error: String(error) }) }
    })()
  })
  // When a session closes or moves to a different project window, its tool
  // views return first; no child is left attached to a stale owner.
  subscribeGoIDEEvents((event) => {
    const change = event.payload as { previousWindowId?: string } | undefined
    if (event.type !== 'session.closed' && !(event.type === 'session.window-changed' && change?.previousWindowId === useGoIDEWindowsStore.getState().context.windowId)) return
    for (const key of useStudioTools.getState().detached) {
      for (const tool of STUDIO_TOOLS) {
        if (!key.endsWith(`-${tool}`) || !key.startsWith('tool-')) continue
        const session = key.slice(5, -(tool.length + 1))
        if (session === event.sessionId) void AppBindings.CloseStudioToolWindow(session, tool)
      }
    }
  })
}

async function runOwnerAction(message: Request, state: NonNullable<Snapshot>): Promise<unknown> {
  const { action, args, tool, session } = message
  const ide = useGoIDEStore.getState()
  const root = state.session.project.realPath
  const runId = String(args[0] ?? '')
  switch (action) {
    case 'snapshot': return tool === 'terminal' ? exportTerminalHistory((await listGoIDETerminals(session)).map((item) => item.id)) : null
    case 'view': {
      const [name, value] = args
      if (typeof name !== 'string' || !['string', 'boolean'].includes(typeof value) && value !== null) throw new Error('Invalid view state')
      patchToolView(state.key, name, value as string | boolean | null)
      return null
    }
    case 'flushView': {
      const view = args[0]
      if (!view || typeof view !== 'object' || Array.isArray(view)) throw new Error('Invalid view state')
      for (const [name, value] of Object.entries(view)) {
        if (typeof value === 'string' || typeof value === 'boolean' || value === null) patchToolView(state.key, name, value)
      }
      return null
    }
    case 'consumeDraft': useGoStudioAssistantStore.setState({ draft: null }); return null
    case 'consumeTerminalRequest': useGoIDELspStore.setState({ terminalRequest: null }); return null
    case 'selectRun':
    case 'stopRun':
    case 'restartRun':
    case 'sendRunInput': {
      if (!state.executions.some((item) => item.id === runId)) throw new Error('Run belongs to another project')
      if (action === 'selectRun') return useGoIDEStore.setState((current) => ({ activeRunBySession: { ...current.activeRunBySession, [session]: runId } }))
      if (action === 'stopRun') return ide.stopRun(runId)
      if (action === 'restartRun') return ide.restartRun(runId)
      return ide.sendRunInput(runId, String(args[1] ?? ''))
    }
    case 'openLocation': await focusProject(session); return ide.openLocation(String(args[0]), Number(args[1]), Number(args[2] ?? 1))
    case 'openExternalLocation': await focusProject(session); return ide.openExternalLocation(String(args[0]), Number(args[1]), Number(args[2] ?? 1))
    case 'showToolWindow': await focusProject(session); useGoIDELspStore.getState().showToolWindow(args[0] as Parameters<ReturnType<typeof useGoIDELspStore.getState>['showToolWindow']>[0]); return null
    case 'startTests': void useGoIDETestsStore.getState().start({ ...(args[0] as Parameters<ReturnType<typeof useGoIDETestsStore.getState>['start']>[0]), sessionId: session }); return null
  }
  const agent = agentStore(tool)?.getState()
  if (agent) {
    switch (action) {
      case 'ensure': return agent.ensure()
      case 'setWorkspace': return agent.setWorkspace(root)
      case 'sendChat': void agent.sendChat(root, String(args[1] ?? ''), args[2] as Parameters<typeof agent.sendChat>[2]); return null
      case 'stopChat': return agent.stopChat(root)
      case 'newChat': return agent.newChat(root)
      case 'respondPermission': return agent.respondPermission(String(args[0]), args[1] === true)
      case 'setDialogOpen': await focusProject(session); return agent.setDialogOpen(args[0] === true)
    }
  }
  if (tool === 'copilot') {
    const copilot = useCopilotStore.getState()
    switch (action) {
      case 'loadChatModels': return copilot.loadChatModels()
      case 'sendChat': void copilot.sendChat(root, String(args[1] ?? ''), args[2] as Parameters<typeof copilot.sendChat>[2]); return null
      case 'stopChat': return copilot.stopChat(root)
      case 'newChat': return copilot.newChat(root)
      case 'selectChatModel': return copilot.selectChatModel(root, String(args[1]))
      case 'setDialogOpen': await focusProject(session); return copilot.setDialogOpen(args[0] === true)
    }
  }
  throw new Error('Unsupported tool command')
}

async function focusProject(session: string) {
  const owner = useGoIDEWindowsStore.getState().ownerOf(session)
  if (useGoIDEStore.getState().activeSessionId !== session) await useGoIDEStore.getState().selectSession(session)
  if (owner === 'main') { useAppStore.getState().setActiveRail('goide'); await AppBindings.FocusMainWindow() }
  else await focusGoIDESessionWindow(owner)
}

export function consumeTerminalRequest() {
  useGoIDELspStore.setState({ terminalRequest: null })
  if (toolContext()) void toolRequest('consumeTerminalRequest')
}

export async function flushStudioToolView() {
  const context = toolContext()
  if (context) await toolRequest('flushView', [useStudioTools.getState().views[context.key] ?? {}])
}

export function toolRequest(action: string, args: unknown[] = []): Promise<unknown> {
  const context = toolContext()
  if (!context) return Promise.reject(new Error('Not a tool window'))
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The project window did not respond')) }, 10_000)
    pending.set(id, { resolve, reject, timer })
    void Events.Emit(REQUEST, { ...context, id, action, args }).catch((error) => { clearTimeout(timer); pending.delete(id); reject(error) })
  })
}

export function startStudioToolClient(onReady: () => void) {
  if (clientStarted) return
  clientStarted = true
  const context = toolContext()!
  let bootstrapped = false
  let receivedSnapshot = false
  startGoStudioTerminalBus()
  Events.On(RESPONSE, (event) => {
    const reply = event.data as { key: string; id: string; result?: unknown; error?: string }
    if (reply?.key !== context.key) return
    const request = pending.get(reply.id)
    if (!request) return
    clearTimeout(request.timer); pending.delete(reply.id)
    if (reply.error) request.reject(new Error(reply.error))
    else request.resolve(reply.result)
  })
  Events.On(SNAPSHOT, (event) => {
    const state = event.data as Snapshot
    if (!state || state.key !== context.key) return
    receivedSnapshot = true
    useGoIDEStore.setState({ sessions: [state.session], activeSessionId: context.session, documents: state.document ? [state.document] : [], activeDocumentBySession: state.document ? { [context.session]: state.document.document.id } : {}, executions: state.executions, activeRunBySession: { [context.session]: state.activeRun }, consoleByRun: state.consoleByRun })
    if (state.agent) agentStore(context.tool)?.setState(state.agent)
    if (state.copilot) useCopilotStore.setState(state.copilot)
    useGoStudioAssistantStore.setState({ draft: state.draft })
    if (context.tool === 'terminal') useGoIDELspStore.setState({ terminalRequest: state.terminalRequest })
    const view = { ...state.view }
    for (const [name, optimistic] of optimisticViews) view[name] = optimistic.value
    useStudioTools.setState((current) => ({ views: { ...current.views, [context.key]: view } }))
    if (bootstrapped) onReady()
  })
  // Explicit allowlists: a child never initializes another IDE or AI client.
  const forward = (action: string) => (...args: unknown[]) => toolRequest(action, args).catch((error) => { useStudioTools.setState({ error: String(error) }); return undefined })
  useGoIDEStore.setState({
    stopRun: forward('stopRun') as ReturnType<typeof useGoIDEStore.getState>['stopRun'],
    restartRun: forward('restartRun') as ReturnType<typeof useGoIDEStore.getState>['restartRun'],
    sendRunInput: forward('sendRunInput') as ReturnType<typeof useGoIDEStore.getState>['sendRunInput'],
    openLocation: forward('openLocation') as ReturnType<typeof useGoIDEStore.getState>['openLocation'],
    openExternalLocation: forward('openExternalLocation') as ReturnType<typeof useGoIDEStore.getState>['openExternalLocation'],
  })
  agentStore(context.tool)?.setState(Object.fromEntries(['ensure', 'setWorkspace', 'sendChat', 'stopChat', 'newChat', 'respondPermission', 'setDialogOpen'].map((action) => [action, forward(action)])))
  useCopilotStore.setState(Object.fromEntries(['loadChatModels', 'sendChat', 'stopChat', 'newChat', 'selectChatModel', 'setDialogOpen'].map((action) => [action, forward(action)])))
  useGoIDELspStore.setState({ showToolWindow: (view) => { void forward('showToolWindow')(view) } })
  useGoIDETestsStore.setState({ start: forward('startTests') as ReturnType<typeof useGoIDETestsStore.getState>['start'] })
  useGoStudioAssistantStore.setState({ takeDraft: () => { const draft = useGoStudioAssistantStore.getState().draft; useGoStudioAssistantStore.setState({ draft: null }); void forward('consumeDraft')(); return draft } })
  setViewForwarder((_key, name, value) => {
    const revision = ++viewRevision
    optimisticViews.set(name, { value, revision })
    void toolRequest('view', [name, value]).catch((error) => useStudioTools.setState({ error: String(error) })).finally(() => {
      if (optimisticViews.get(name)?.revision === revision) optimisticViews.delete(name)
    })
  })
  void toolRequest('snapshot').then((history) => {
    if (context.tool === 'terminal') importTerminalHistory(history)
    bootstrapped = true
    if (receivedSnapshot) onReady()
  }).catch((error) => useStudioTools.setState({ error: String(error) }))
}
