import * as GoIDEBindings from '../../bindings/adomnia/goide'
import type {
  Breakpoint, BreakpointState, DebugFrame, DebugInstruction, DebugMemory, DebugRequest, DebugScope, DebugSessionInfo, DebugThread, DebugVariable,
  DelveInfo, EvaluateResult, Execution, FileBreakpoints, FunctionBreakpoint, FunctionBreakpointSettings, FunctionBreakpointsView,
  GoroutineOverview, GoroutineSummary, ProcessInfo,
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
export type GoIDEDebugInstruction = DebugInstruction
export type GoIDEDebugMemory = DebugMemory
export type GoIDEDebugScope = DebugScope
export type GoIDEDebugVariable = DebugVariable
export type GoIDEEvaluateResult = EvaluateResult
export type GoIDEBreakpoint = Breakpoint
export type GoIDEBreakpointState = BreakpointState
export type GoIDEFunctionBreakpoint = FunctionBreakpoint
export type GoIDEFunctionBreakpointSettings = FunctionBreakpointSettings
export type GoIDEFunctionBreakpoints = FunctionBreakpointsView
export type GoIDEFileBreakpoints = FileBreakpoints
export type GoIDEDelveInfo = DelveInfo
export type GoIDEGoroutineOverview = GoroutineOverview
export type GoIDEGoroutine = GoroutineSummary
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

/** Tutte le goroutine della pausa corrente con stato, causa del blocco e origine (vista Concurrency). */
export function getGoIDEDebugGoroutines(debugId: string): Promise<GoroutineOverview> {
  return GoIDEBindings.DebugGoroutines(debugId)
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

export function setGoIDEBreakpoints(sessionId: string, relativePath: string, breakpoints: Breakpoint[]): Promise<BreakpointState[]> {
  return GoIDEBindings.SetBreakpoints(sessionId, relativePath, breakpoints)
}

export function listGoIDEFunctionBreakpoints(sessionId: string): Promise<FunctionBreakpointsView> {
  return GoIDEBindings.ListFunctionBreakpoints(sessionId)
}

/** Breakpoint di funzione e "Stop on every panic" del progetto. */
export function setGoIDEFunctionBreakpoints(sessionId: string, settings: FunctionBreakpointSettings): Promise<FunctionBreakpointsView> {
  return GoIDEBindings.SetFunctionBreakpoints(sessionId, settings)
}

/** Run to Cursor: riprende il programma in pausa fino alla riga indicata. */
export function runGoIDEDebugToCursor(debugId: string, relativePath: string, line: number, threadId: number): Promise<void> {
  return GoIDEBindings.DebugRunToCursor(debugId, relativePath, line, threadId)
}

export function listGoIDEBreakpoints(sessionId: string): Promise<FileBreakpoints[]> {
  return GoIDEBindings.ListBreakpoints(sessionId)
}

export type GoIDEProcessInfo = ProcessInfo

/** Processi locali per Attach to Process (solo lettura). */
export function listGoIDEProcesses(): Promise<ProcessInfo[]> {
  return GoIDEBindings.ListProcesses()
}

/** Codice macchina attorno all'istruzione corrente del frame (DAP disassemble di Delve). */
export function getGoIDEDebugDisassembly(debugId: string, address: string, before = 12, after = 12): Promise<DebugInstruction[]> {
  return GoIDEBindings.DebugDisassemble(debugId, address, before, after)
}

/** Aggiunge o toglie lo scope "Registers" dalle variabili dei frame (dlv config showRegisters). */
export function showGoIDEDebugRegisters(debugId: string, show: boolean): Promise<void> {
  return GoIDEBindings.DebugShowRegisters(debugId, show)
}

/** Byte di memoria da un indirizzo (0x…) o dall'indirizzo di un'espressione (es. &buf[0]) nel frame. */
export function readGoIDEDebugMemory(debugId: string, location: string, length: number, frameId: number): Promise<DebugMemory> {
  return GoIDEBindings.DebugReadMemory(debugId, location, length, frameId)
}
