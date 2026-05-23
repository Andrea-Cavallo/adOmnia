import type { DebugNetworkEntry } from '@/stores/browser-debug'

// ─── Discovery types ──────────────────────────────────────────────────────────

export interface DebugTarget {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl: string
  devtoolsFrontendUrl: string
  faviconUrl: string
  attached: boolean
}

export interface DebugEndpoint {
  port: number
  host: string
  browserName: string
  version: string
  targets: DebugTarget[]
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface ConsoleEntry {
  id: string
  type: 'log' | 'error' | 'warn' | 'info' | 'result'
  text: string
  timestamp: number
}

export interface BreakpointInfo {
  id: string
  scriptUrl: string
  scriptId?: string
  lineNumber: number
  columnNumber: number
  condition?: string
}

export interface CallFrame {
  id: string
  functionName: string
  url: string
  scriptId: string
  lineNumber: number
  columnNumber: number
}

export interface PausedState {
  paused: boolean
  reason: string
  callFrames: CallFrame[]
  scriptUrl: string
  scriptId: string
  lineNumber: number
}

export interface ScriptInfo {
  scriptId: string
  url: string
  startLine: number
  endLine: number
  executionContextId: number
  hash: string
}

export interface SourceFileInfo {
  id: string
  url: string
  type: string
  mimeType: string
  scriptId?: string
  frameId?: string
  startLine: number
  endLine: number
  canSetBreakpoint: boolean
  fromDebugger: boolean
}

export interface DOMNode {
  nodeId: number
  nodeType: number
  nodeName: string
  localName: string
  nodeValue: string
  attributes: string[]
  childCount: number
  children?: DOMNode[]
}

export type DOMBreakpointType = 'subtree-modified' | 'attribute-modified' | 'node-removed'

export interface DOMBreakpointInfo {
  nodeId: number
  type: DOMBreakpointType
}

export interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  size: number
  httpOnly: boolean
  secure: boolean
  sameSite: string
}

export interface StorageItem {
  key: string
  value: string
}

export interface ThrottleProfile {
  name: string
  downloadKbps: number
  uploadKbps: number
  latencyMs: number
}

// ─── Window type augmentation ─────────────────────────────────────────────────

declare global {
  interface WailsGoMain {
    BrowserDebug: {
      // Existing
      LaunchBrowser: (url: string) => Promise<void>
      Connect: () => Promise<void>
      Disconnect: () => Promise<void>
      IsConnected: () => Promise<boolean>
      GetTraffic: () => Promise<DebugNetworkEntry[]>
      GetTrafficFiltered: (filter: string) => Promise<DebugNetworkEntry[]>
      GetRequestBody: (requestId: string) => Promise<string>
      GetResponseBody: (requestId: string) => Promise<string>
      ClearTraffic: () => Promise<void>
      StopBrowser: () => Promise<void>

      // Console
      EvalJS: (expression: string) => Promise<ConsoleEntry>
      EnableConsole: () => Promise<void>
      GetConsoleLogs: () => Promise<ConsoleEntry[]>
      ClearConsoleLogs: () => Promise<void>

      // Debugger
      EnableDebugger: () => Promise<void>
      DisableDebugger: () => Promise<void>
      SetBreakpoint: (url: string, line: number, condition: string) => Promise<string>
      SetBreakpointByScriptID: (scriptId: string, line: number, column: number, condition: string) => Promise<string>
      RemoveBreakpoint: (breakpointId: string) => Promise<void>
      GetBreakpoints: () => Promise<BreakpointInfo[]>
      GetScripts: () => Promise<ScriptInfo[]>
      GetScriptSource: (scriptId: string) => Promise<string>
      GetSourceFiles: () => Promise<SourceFileInfo[]>
      GetSourceFileContent: (sourceId: string) => Promise<string>
      ReloadPageNoCache: () => Promise<void>
      Resume: () => Promise<void>
      StepOver: () => Promise<void>
      StepInto: () => Promise<void>
      StepOut: () => Promise<void>
      GetPausedState: () => Promise<PausedState>

      // DOM
      EnableDOM: () => Promise<void>
      GetDocument: (depth: number) => Promise<DOMNode>
      GetNodeHTML: (nodeId: number) => Promise<string>
      GetPageSource: () => Promise<string>
      QuerySelector: (selector: string) => Promise<DOMNode>
      GetComputedStyle: (nodeId: number) => Promise<Record<string, string>>
      HighlightNode: (nodeId: number) => Promise<void>
      HideHighlight: () => Promise<void>
      SetDOMBreakpoint: (nodeId: number, breakpointType: DOMBreakpointType) => Promise<void>
      RemoveDOMBreakpoint: (nodeId: number, breakpointType: DOMBreakpointType) => Promise<void>
      GetDOMBreakpoints: () => Promise<DOMBreakpointInfo[]>

      // Storage
      GetCookies: () => Promise<CookieEntry[]>
      DeleteCookie: (name: string, domain: string) => Promise<void>
      GetLocalStorage: () => Promise<StorageItem[]>
      GetSessionStorage: () => Promise<StorageItem[]>
      GetIndexedDBDatabases: () => Promise<string[]>

      // Throttling
      SetThrottling: (downloadKbps: number, uploadKbps: number, latencyMs: number) => Promise<void>
      ClearThrottling: () => Promise<void>
      GetThrottleProfiles: () => Promise<ThrottleProfile[]>
    }
  }
}

// ─── Binding accessor ─────────────────────────────────────────────────────────

function getBrowserDebugBinding() {
  return window?.go?.main?.BrowserDebug
}

// ─── Existing wrappers ────────────────────────────────────────────────────────

export async function launchBrowser(url: string): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.LaunchBrowser(url)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to launch browser'
    throw new Error(message)
  }
}

export async function connectDebugger(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.Connect()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to connect'
    throw new Error(message)
  }
}

export async function disconnectDebugger(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.Disconnect()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to disconnect'
    throw new Error(message)
  }
}

export async function isConnected(): Promise<boolean> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return false
    return await binding.IsConnected()
  } catch {
    return false
  }
}

export async function getTraffic(): Promise<DebugNetworkEntry[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetTraffic()
  } catch {
    return []
  }
}

export async function getTrafficFiltered(filter: string): Promise<DebugNetworkEntry[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetTrafficFiltered(filter)
  } catch {
    return []
  }
}

export async function getRequestBody(requestId: string): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return ''
    return await binding.GetRequestBody(requestId)
  } catch {
    return ''
  }
}

export async function getResponseBody(requestId: string): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return ''
    return await binding.GetResponseBody(requestId)
  } catch {
    return ''
  }
}

export async function clearTraffic(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.ClearTraffic()
  } catch {
    // silently ignore
  }
}

export async function stopBrowser(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.StopBrowser()
  } catch {
    // silently ignore
  }
}

// ─── Discovery & target-connect wrappers ─────────────────────────────────────

export async function discoverEndpoints(): Promise<DebugEndpoint[]> {
  try {
    const b = window?.go?.main?.BrowserDebug as Record<string, (...a: unknown[]) => Promise<unknown>> | undefined
    if (!b?.DiscoverEndpoints) return []
    return ((await b.DiscoverEndpoints()) as DebugEndpoint[]) ?? []
  } catch {
    return []
  }
}

export async function connectToTarget(wsUrl: string): Promise<void> {
  try {
    const b = window?.go?.main?.BrowserDebug as Record<string, (...a: unknown[]) => Promise<unknown>> | undefined
    if (!b?.ConnectToTarget) return
    await b.ConnectToTarget(wsUrl)
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : 'Failed to connect to target')
  }
}

export async function launchBrowserForDebug(url: string, port: number): Promise<DebugTarget[]> {
  try {
    const b = window?.go?.main?.BrowserDebug as Record<string, (...a: unknown[]) => Promise<unknown>> | undefined
    if (!b?.LaunchBrowserForDebug) return []
    return (await b.LaunchBrowserForDebug(url, port)) as DebugTarget[]
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : 'Failed to launch browser')
  }
}

// ─── Console wrappers ─────────────────────────────────────────────────────────

export async function evalJS(expression: string): Promise<ConsoleEntry | null> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return null
    return await binding.EvalJS(expression)
  } catch {
    return null
  }
}

export async function enableConsole(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.EnableConsole()
  } catch {
    // silently ignore
  }
}

export async function getConsoleLogs(): Promise<ConsoleEntry[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetConsoleLogs()
  } catch {
    return []
  }
}

export async function clearConsoleLogs(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.ClearConsoleLogs()
  } catch {
    // silently ignore
  }
}

// ─── Debugger wrappers ────────────────────────────────────────────────────────

export async function enableDebugger(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.EnableDebugger()
  } catch {
    // silently ignore
  }
}

export async function disableDebugger(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.DisableDebugger()
  } catch {
    // silently ignore
  }
}

export async function setBreakpoint(
  url: string,
  line: number,
  condition: string
): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return ''
    return await binding.SetBreakpoint(url, line, condition)
  } catch {
    return ''
  }
}

export async function setBreakpointByScriptID(
  scriptId: string,
  line: number,
  column: number,
  condition: string
): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.SetBreakpointByScriptID) return ''
    return await binding.SetBreakpointByScriptID(scriptId, line, column, condition)
  } catch {
    return ''
  }
}

export async function removeBreakpoint(breakpointId: string): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.RemoveBreakpoint(breakpointId)
  } catch {
    // silently ignore
  }
}

export async function getBreakpoints(): Promise<BreakpointInfo[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetBreakpoints()
  } catch {
    return []
  }
}

export async function getScripts(): Promise<ScriptInfo[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.GetScripts) return []
    return await binding.GetScripts()
  } catch {
    return []
  }
}

export async function getScriptSource(scriptId: string): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.GetScriptSource) return ''
    return await binding.GetScriptSource(scriptId)
  } catch {
    return ''
  }
}

export async function getSourceFiles(): Promise<SourceFileInfo[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.GetSourceFiles) return []
    return await binding.GetSourceFiles()
  } catch {
    return []
  }
}

export async function getSourceFileContent(sourceId: string): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.GetSourceFileContent) return ''
    return await binding.GetSourceFileContent(sourceId)
  } catch {
    return ''
  }
}

export async function reloadPageNoCache(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.ReloadPageNoCache) return
    await binding.ReloadPageNoCache()
  } catch {
    // silently ignore
  }
}

export async function resume(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.Resume()
  } catch {
    // silently ignore
  }
}

export async function stepOver(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.StepOver()
  } catch {
    // silently ignore
  }
}

export async function stepInto(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.StepInto()
  } catch {
    // silently ignore
  }
}

export async function stepOut(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.StepOut()
  } catch {
    // silently ignore
  }
}

export async function getPausedState(): Promise<PausedState> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) {
      return { paused: false, reason: '', callFrames: [], scriptUrl: '', scriptId: '', lineNumber: 0 }
    }
    return await binding.GetPausedState()
  } catch {
    return { paused: false, reason: '', callFrames: [], scriptUrl: '', scriptId: '', lineNumber: 0 }
  }
}

// ─── DOM wrappers ─────────────────────────────────────────────────────────────

export async function enableDOM(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.EnableDOM()
  } catch {
    // silently ignore
  }
}

export async function getDocument(depth: number): Promise<DOMNode | null> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return null
    return await binding.GetDocument(depth)
  } catch {
    return null
  }
}

export async function getNodeHTML(nodeId: number): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return ''
    return await binding.GetNodeHTML(nodeId)
  } catch {
    return ''
  }
}

export async function getPageSource(): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.GetPageSource) return ''
    return await binding.GetPageSource()
  } catch {
    return ''
  }
}

export async function querySelector(selector: string): Promise<DOMNode | null> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return null
    return await binding.QuerySelector(selector)
  } catch {
    return null
  }
}

export async function getComputedStyleForNode(
  nodeId: number
): Promise<Record<string, string>> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return {}
    return await binding.GetComputedStyle(nodeId)
  } catch {
    return {}
  }
}

export async function highlightNode(nodeId: number): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.HighlightNode(nodeId)
  } catch {
    // silently ignore
  }
}

export async function hideHighlight(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.HideHighlight()
  } catch {
    // silently ignore
  }
}

export async function setDOMBreakpoint(
  nodeId: number,
  breakpointType: DOMBreakpointType
): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.SetDOMBreakpoint) return
    await binding.SetDOMBreakpoint(nodeId, breakpointType)
  } catch {
    // silently ignore
  }
}

export async function removeDOMBreakpoint(
  nodeId: number,
  breakpointType: DOMBreakpointType
): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.RemoveDOMBreakpoint) return
    await binding.RemoveDOMBreakpoint(nodeId, breakpointType)
  } catch {
    // silently ignore
  }
}

export async function getDOMBreakpoints(): Promise<DOMBreakpointInfo[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.GetDOMBreakpoints) return []
    return await binding.GetDOMBreakpoints()
  } catch {
    return []
  }
}

// ─── Storage wrappers ─────────────────────────────────────────────────────────

export async function getCookies(): Promise<CookieEntry[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetCookies()
  } catch {
    return []
  }
}

export async function deleteCookie(name: string, domain: string): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.DeleteCookie(name, domain)
  } catch {
    // silently ignore
  }
}

export async function getLocalStorage(): Promise<StorageItem[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetLocalStorage()
  } catch {
    return []
  }
}

export async function getSessionStorage(): Promise<StorageItem[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetSessionStorage()
  } catch {
    return []
  }
}

export async function getIndexedDBDatabases(): Promise<string[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetIndexedDBDatabases()
  } catch {
    return []
  }
}

// ─── Throttling wrappers ──────────────────────────────────────────────────────

export async function setThrottling(
  downloadKbps: number,
  uploadKbps: number,
  latencyMs: number
): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.SetThrottling(downloadKbps, uploadKbps, latencyMs)
  } catch {
    // silently ignore
  }
}

export async function clearThrottling(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.ClearThrottling()
  } catch {
    // silently ignore
  }
}

export async function getThrottleProfiles(): Promise<ThrottleProfile[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetThrottleProfiles()
  } catch {
    return []
  }
}
