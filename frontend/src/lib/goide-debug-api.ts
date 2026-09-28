import * as GoIDEBindings from '../../bindings/adomnia/goide'
import type {
  BreakpointState, DebugFrame, DebugRequest, DebugScope, DebugSessionInfo, DebugThread, DebugVariable,
  DelveInfo, EvaluateResult, Execution, FileBreakpoints, ProcessInfo,
} from '../../bindings/adomnia/internal/goide/models'

export type GoIDEDebugRequest = DebugRequest
export type GoIDEDebugSession = DebugSessionInfo
/** Payload dell'evento debug.output (non esposto dai binding perché viaggia solo come evento). */
export interface GoIDEDebugOutput {
  debugId: string
  category: string
  text: string
}
export type GoIDEDebugThread = DebugThread
export type GoIDEDebugFrame = DebugFrame
export type GoIDEDebugScope = DebugScope
export type GoIDEDebugVariable = DebugVariable
export type GoIDEEvaluateResult = EvaluateResult
export type GoIDEBreakpointState = BreakpointState
export type GoIDEFileBreakpoints = FileBreakpoints
export type GoIDEDelveInfo = DelveInfo
export type GoIDEDebugStepAction = 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut'

export function detectGoIDEDelve(sessionId: string): Promise<DelveInfo> {
  return GoIDEBindings.DetectDelve(sessionId)
}

export function configureGoIDEDelve(sessionId: string, binary: string): Promise<void> {
  return GoIDEBindings.ConfigureDelve(sessionId, binary)
}

export function installGoIDEDelve(sessionId: string): Promise<Execution> {
  return GoIDEBindings.InstallDelve(sessionId, true)
}

export function startGoIDEDebug(request: DebugRequest): Promise<DebugSessionInfo> {
  return GoIDEBindings.StartDebug(request)
}

export function stopGoIDEDebug(debugId: string): Promise<void> {
  return GoIDEBindings.StopDebug(debugId)
}

export function stepGoIDEDebug(debugId: string, action: GoIDEDebugStepAction, threadId: number): Promise<void> {
  return GoIDEBindings.DebugStep(debugId, action, threadId)
}

export function listGoIDEDebugThreads(debugId: string): Promise<DebugThread[]> {
  return GoIDEBindings.DebugThreads(debugId)
}

export function getGoIDEDebugStack(debugId: string, threadId: number): Promise<DebugFrame[]> {
  return GoIDEBindings.DebugStackTrace(debugId, threadId)
}

export function getGoIDEDebugScopes(debugId: string, frameId: number): Promise<DebugScope[]> {
  return GoIDEBindings.DebugScopes(debugId, frameId)
}

export function getGoIDEDebugVariables(debugId: string, reference: number): Promise<DebugVariable[]> {
  return GoIDEBindings.DebugVariables(debugId, reference)
}

export function evaluateGoIDEDebug(debugId: string, expression: string, frameId: number, context: 'watch' | 'repl' | 'hover'): Promise<EvaluateResult> {
  return GoIDEBindings.DebugEvaluate(debugId, expression, frameId, context)
}

export function listGoIDEDebugSessions(sessionId: string): Promise<DebugSessionInfo[]> {
  return GoIDEBindings.ListDebugSessions(sessionId)
}

export function setGoIDEBreakpoints(sessionId: string, relativePath: string, lines: number[]): Promise<BreakpointState[]> {
  return GoIDEBindings.SetBreakpoints(sessionId, relativePath, lines)
}

export function listGoIDEBreakpoints(sessionId: string): Promise<FileBreakpoints[]> {
  return GoIDEBindings.ListBreakpoints(sessionId)
}

export type GoIDEProcessInfo = ProcessInfo

/** Processi locali per Attach to Process (solo lettura). */
export function listGoIDEProcesses(): Promise<ProcessInfo[]> {
  return GoIDEBindings.ListProcesses()
}
