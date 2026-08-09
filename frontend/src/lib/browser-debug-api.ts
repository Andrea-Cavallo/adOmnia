import * as BrowserDebugBindings from '../../bindings/adomnia/browserdebug'
import type {
  ConsoleEntry as BindingConsoleEntry,
  DebugNetworkEntry as BindingDebugNetworkEntry,
  DOMBreakpointInfo as BindingDOMBreakpointInfo,
} from '../../bindings/adomnia/internal/browser/models'
import type { DebugNetworkEntry } from '@/stores/browser-debug'

// Discovery types

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

export function inspectablePageTargets(targets: DebugTarget[] | null | undefined): DebugTarget[] {
  return (targets ?? []).filter((target) => (
    target.type === 'page'
    && !!target.webSocketDebuggerUrl
    && !target.url.startsWith('devtools://')
  ))
}

// Shared types

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

// Window type augmentation

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

// Binding accessor

function getBrowserDebugBinding() {
  // Wails 3 has no `window.go` global; services come from generated bindings.
  // Cast once. The generated bindings type Go maps and enums more loosely than
  // the local models in this file, which stay the authority for callers — the
  // same arrangement the old `window.go.main.BrowserDebug` global provided.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const binding = BrowserDebugBindings as unknown as Record<string, (...a: unknown[]) => Promise<any>>
  if (!binding) throw new Error('Browser Debug backend is not available')
  return binding
}

function browserDebugError(err: unknown, fallback = 'Browser Debug operation failed'): Error {
  if (err instanceof Error && err.message.trim()) return new Error(err.message)
  if (typeof err === 'string' && err.trim()) return new Error(err)
  if (err && typeof err === 'object') {
    const message = 'message' in err ? String((err as { message?: unknown }).message ?? '').trim() : ''
    if (message) return new Error(message)
  }
  return new Error(fallback)
}

function normalizeStringRecord(value: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function normalizeConsoleEntry(entry: { id: string; type: string; text: string; timestamp: number }): ConsoleEntry {
  const type = ['log', 'error', 'warn', 'info', 'result'].includes(entry.type)
    ? entry.type as ConsoleEntry['type']
    : 'log'
  return { ...entry, type }
}

function normalizeDOMBreakpoint(entry: { nodeId: number; type: string }): DOMBreakpointInfo | null {
  if (!['subtree-modified', 'attribute-modified', 'node-removed'].includes(entry.type)) return null
  return { nodeId: entry.nodeId, type: entry.type as DOMBreakpointType }
}

// Existing wrappers

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

export async function getTraffic(): Promise<DebugNetworkEntry[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return (await binding.GetTraffic()).map((entry: BindingDebugNetworkEntry) => ({
      ...entry,
      requestHeaders: normalizeStringRecord(entry.requestHeaders),
      responseHeaders: normalizeStringRecord(entry.responseHeaders),
    }))
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : 'Failed to read browser traffic')
  }
}

export async function getRequestBody(requestId: string): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return ''
    return await binding.GetRequestBody(requestId)
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : 'Failed to read request body')
  }
}

export async function getResponseBody(requestId: string): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return ''
    return await binding.GetResponseBody(requestId)
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : 'Failed to read response body')
  }
}

export async function clearTraffic(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.ClearTraffic()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

// Discovery and target-connect wrappers

export async function discoverEndpoints(): Promise<DebugEndpoint[]> {
  try {
    const b = getBrowserDebugBinding()
    if (!b?.DiscoverEndpoints) return []
    return ((await b.DiscoverEndpoints()) as DebugEndpoint[]) ?? []
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : 'Failed to discover browser debug endpoints')
  }
}

export async function connectToTarget(wsUrl: string): Promise<void> {
  try {
    const b = getBrowserDebugBinding()
    if (!b?.ConnectToTarget) return
    await b.ConnectToTarget(wsUrl)
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : 'Failed to connect to target')
  }
}

export async function launchBrowserForDebug(url: string, port: number): Promise<DebugTarget[]> {
  try {
    const b = getBrowserDebugBinding()
    if (!b?.LaunchBrowserForDebug) return []
    return (await b.LaunchBrowserForDebug(url, port)) as DebugTarget[]
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : 'Failed to launch browser')
  }
}

// Console wrappers

export async function evalJS(expression: string): Promise<ConsoleEntry | null> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return null
    const result = await binding.EvalJS(expression) as BindingConsoleEntry | null
    return result ? normalizeConsoleEntry(result) : null
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function enableConsole(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.EnableConsole()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getConsoleLogs(): Promise<ConsoleEntry[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return (await binding.GetConsoleLogs() as BindingConsoleEntry[]).map(normalizeConsoleEntry)
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function clearConsoleLogs(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.ClearConsoleLogs()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

// Debugger wrappers

export async function enableDebugger(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.EnableDebugger()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function disableDebugger(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.DisableDebugger()
  } catch (err: unknown) {
    throw browserDebugError(err)
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
  } catch (err: unknown) {
    throw browserDebugError(err)
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
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function removeBreakpoint(breakpointId: string): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.RemoveBreakpoint(breakpointId)
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getBreakpoints(): Promise<BreakpointInfo[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetBreakpoints()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getSourceFiles(): Promise<SourceFileInfo[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.GetSourceFiles) return []
    return await binding.GetSourceFiles()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getSourceFileContent(sourceId: string): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.GetSourceFileContent) return ''
    return await binding.GetSourceFileContent(sourceId)
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function reloadPageNoCache(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.ReloadPageNoCache) return
    await binding.ReloadPageNoCache()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function resume(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.Resume()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function stepOver(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.StepOver()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function stepInto(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.StepInto()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function stepOut(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.StepOut()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getPausedState(): Promise<PausedState> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) {
      return { paused: false, reason: '', callFrames: [], scriptUrl: '', scriptId: '', lineNumber: 0 }
    }
    return await binding.GetPausedState()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

// DOM wrappers

export async function enableDOM(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.EnableDOM()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getDocument(depth: number): Promise<DOMNode | null> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return null
    return await binding.GetDocument(depth)
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getNodeHTML(nodeId: number): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return ''
    return await binding.GetNodeHTML(nodeId)
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getPageSource(): Promise<string> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.GetPageSource) return ''
    return await binding.GetPageSource()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function querySelector(selector: string): Promise<DOMNode | null> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return null
    return await binding.QuerySelector(selector)
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getComputedStyleForNode(
  nodeId: number
): Promise<Record<string, string>> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return {}
    return normalizeStringRecord(await binding.GetComputedStyle(nodeId))
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function highlightNode(nodeId: number): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.HighlightNode(nodeId)
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function hideHighlight(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.HideHighlight()
  } catch (err: unknown) {
    throw browserDebugError(err)
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
  } catch (err: unknown) {
    throw browserDebugError(err)
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
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getDOMBreakpoints(): Promise<DOMBreakpointInfo[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding?.GetDOMBreakpoints) return []
    return (await binding.GetDOMBreakpoints() as BindingDOMBreakpointInfo[])
      .map(normalizeDOMBreakpoint)
      .filter((entry: DOMBreakpointInfo | null): entry is DOMBreakpointInfo => entry !== null)
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

// Storage wrappers

export async function getCookies(): Promise<CookieEntry[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetCookies()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function deleteCookie(name: string, domain: string): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.DeleteCookie(name, domain)
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getLocalStorage(): Promise<StorageItem[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetLocalStorage()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getSessionStorage(): Promise<StorageItem[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetSessionStorage()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getIndexedDBDatabases(): Promise<string[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetIndexedDBDatabases()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

// Throttling wrappers

export async function setThrottling(
  downloadKbps: number,
  uploadKbps: number,
  latencyMs: number
): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.SetThrottling(downloadKbps, uploadKbps, latencyMs)
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function clearThrottling(): Promise<void> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return
    await binding.ClearThrottling()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}

export async function getThrottleProfiles(): Promise<ThrottleProfile[]> {
  try {
    const binding = getBrowserDebugBinding()
    if (!binding) return []
    return await binding.GetThrottleProfiles()
  } catch (err: unknown) {
    throw browserDebugError(err)
  }
}
