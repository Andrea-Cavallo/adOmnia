import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  enableDebugger,
  disableDebugger,
  setBreakpoint,
  removeBreakpoint,
  getBreakpoints,
  resume,
  stepOver,
  stepInto,
  stepOut,
  getPausedState,
  type BreakpointInfo,
  type PausedState,
  type CallFrame,
} from '@/lib/browser-debug-api'
import {
  Bug,
  Play,
  SkipForward,
  ArrowDownToLine,
  ArrowUpFromLine,
  Plus,
  X,
  Power,
  Pause,
} from 'lucide-react'

export type { BreakpointInfo, CallFrame, PausedState }

export function DebuggerPanel() {
  const [enabled, setEnabled] = useState(false)
  const [breakpoints, setBreakpoints] = useState<BreakpointInfo[]>([])
  const [pausedState, setPausedState] = useState<PausedState | null>(null)

  // Add breakpoint form
  const [bpUrl, setBpUrl] = useState('')
  const [bpLine, setBpLine] = useState('')
  const [bpCondition, setBpCondition] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Poll paused state when debugger is enabled
  useEffect(() => {
    if (enabled) {
      const poll = async () => {
        const state = await getPausedState()
        setPausedState(state)
      }
      poll()
      pollRef.current = setInterval(poll, 500)
    } else {
      setPausedState(null)
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [enabled])

  const refreshBreakpoints = useCallback(async () => {
    const bps = await getBreakpoints()
    setBreakpoints(bps)
  }, [])

  useEffect(() => {
    if (enabled) {
      refreshBreakpoints()
    }
  }, [enabled, refreshBreakpoints])

  const handleToggleDebugger = useCallback(async () => {
    if (enabled) {
      await disableDebugger()
      setEnabled(false)
      setBreakpoints([])
    } else {
      await enableDebugger()
      setEnabled(true)
    }
  }, [enabled])

  const handleAddBreakpoint = useCallback(async () => {
    const line = parseInt(bpLine, 10)
    if (!bpUrl || isNaN(line)) return

    await setBreakpoint(bpUrl, line, bpCondition)
    setBpUrl('')
    setBpLine('')
    setBpCondition('')
    await refreshBreakpoints()
  }, [bpUrl, bpLine, bpCondition, refreshBreakpoints])

  const handleRemoveBreakpoint = useCallback(
    async (id: string) => {
      await removeBreakpoint(id)
      await refreshBreakpoints()
    },
    [refreshBreakpoints]
  )

  const handleResume = useCallback(async () => {
    await resume()
  }, [])

  const handleStepOver = useCallback(async () => {
    await stepOver()
  }, [])

  const handleStepInto = useCallback(async () => {
    await stepInto()
  }, [])

  const handleStepOut = useCallback(async () => {
    await stepOut()
  }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1">
      {/* Top bar */}
      <div className="flex items-center h-9 px-3 gap-2 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <Bug size={12} className="text-text-3" />

        {/* Toggle */}
        <button
          onClick={handleToggleDebugger}
          className={cn(
            'h-6 px-2 rounded text-[10px] font-medium flex items-center gap-1 transition-colors',
            enabled
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              : 'bg-surface-2 border border-border-1 text-text-2 hover:text-text-1'
          )}
        >
          <Power size={10} />
          {enabled ? 'Disable Debugger' : 'Enable Debugger'}
        </button>

        <div className="w-px h-5 bg-border-1" />

        {/* Stepping controls */}
        <button
          onClick={handleResume}
          disabled={!enabled || !pausedState?.paused}
          title="Resume"
          className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Play size={12} />
        </button>
        <button
          onClick={handleStepOver}
          disabled={!enabled || !pausedState?.paused}
          title="Step Over"
          className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <SkipForward size={12} />
        </button>
        <button
          onClick={handleStepInto}
          disabled={!enabled || !pausedState?.paused}
          title="Step Into"
          className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowDownToLine size={12} />
        </button>
        <button
          onClick={handleStepOut}
          disabled={!enabled || !pausedState?.paused}
          title="Step Out"
          className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowUpFromLine size={12} />
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {/* Paused state indicator */}
        {pausedState?.paused && (
          <div className="rounded border border-yellow-500/30 bg-yellow-500/5 p-2">
            <div className="flex items-center gap-2 text-xs text-yellow-400 font-medium">
              <Pause size={12} />
              Paused: {pausedState.reason}
            </div>
            <div className="mt-1 text-[10px] text-text-2 font-mono">
              {pausedState.scriptUrl}:{pausedState.lineNumber}
            </div>

            {/* Call Frames */}
            {pausedState.callFrames.length > 0 && (
              <div className="mt-2 space-y-0.5">
                <div className="text-[10px] text-text-3 uppercase tracking-wide font-medium">
                  Call Stack
                </div>
                {pausedState.callFrames.map((frame) => (
                  <div
                    key={frame.id}
                    className="flex items-center gap-2 text-[10px] font-mono text-text-2 py-0.5"
                  >
                    <span className="text-accent">
                      {frame.functionName || '(anonymous)'}
                    </span>
                    <span className="text-text-3 truncate">
                      {frame.url}:{frame.lineNumber}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Breakpoints section */}
        <div>
          <div className="text-[10px] text-text-3 uppercase tracking-wide font-medium mb-2">
            Breakpoints
          </div>

          {breakpoints.length === 0 && (
            <div className="text-xs text-text-3 py-1">
              No breakpoints set
            </div>
          )}

          <div className="space-y-1">
            {breakpoints.map((bp) => (
              <div
                key={bp.id}
                className="flex items-center gap-2 text-[10px] font-mono bg-surface-0 rounded px-2 py-1 border border-border-1"
              >
                <span className="text-text-1 truncate flex-1">
                  {bp.scriptUrl}:{bp.lineNumber}
                </span>
                {bp.condition && (
                  <span className="text-yellow-400 text-[9px] truncate max-w-[120px]">
                    if: {bp.condition}
                  </span>
                )}
                <button
                  onClick={() => handleRemoveBreakpoint(bp.id)}
                  className="h-4 w-4 rounded flex items-center justify-center text-text-3 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>

          {/* Add breakpoint form */}
          {enabled && (
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={bpUrl}
                  onChange={(e) => setBpUrl(e.target.value)}
                  placeholder="Script URL"
                  className="flex-1 h-6 px-2 rounded bg-surface-0 border border-border-1 text-[10px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
                />
                <input
                  type="text"
                  value={bpLine}
                  onChange={(e) => setBpLine(e.target.value)}
                  placeholder="Line"
                  className="w-14 h-6 px-2 rounded bg-surface-0 border border-border-1 text-[10px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={bpCondition}
                  onChange={(e) => setBpCondition(e.target.value)}
                  placeholder="Condition (optional)"
                  className="flex-1 h-6 px-2 rounded bg-surface-0 border border-border-1 text-[10px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
                />
                <button
                  onClick={handleAddBreakpoint}
                  className="h-6 px-2 rounded bg-accent/10 border border-accent/30 text-[10px] text-accent font-medium flex items-center gap-1 hover:bg-accent/20 transition-colors"
                >
                  <Plus size={10} />
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
