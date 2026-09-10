import { useMemo, useState } from 'react'
import { Check, Copy, FolderPlus, RefreshCw, Trash2, WrapText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { safeSelectFolder } from '@/lib/fileUtils'
import { openSourceLocation, reindexRepositories, resolveFrame, type FrameResolution } from '@/lib/sourcemap-api'
import { useServerPort } from '@/lib/useServerPort'
import { frameCandidates, parseStackTrace, type StackFrame } from '@/lib/loginspector'
import type { Prefs, UpdatePrefs } from './prefs'

interface StackTracePanelProps {
  stack: string
  prefs: Prefs
  updatePrefs: UpdatePrefs
}

export function StackTracePanel({ stack, prefs, updatePrefs }: StackTracePanelProps) {
  const port = useServerPort()
  const parsed = useMemo(() => parseStackTrace(stack), [stack])
  const [wrap, setWrap] = useState(true)
  const [appOnly, setAppOnly] = useState(false)
  const [copied, setCopied] = useState('')
  const [resolutions, setResolutions] = useState<Record<number, FrameResolution | 'loading'>>({})
  const [openError, setOpenError] = useState('')

  const copy = (text: string, token: string) => {
    navigator.clipboard.writeText(text).then(
      () => { setCopied(token); window.setTimeout(() => setCopied(''), 1200) },
      () => setCopied(''),
    )
  }

  const addRepository = async () => {
    try {
      const path = await safeSelectFolder('Select the repository of this stack trace')
      if (path && !prefs.repositoryRoots.includes(path)) {
        updatePrefs({ repositoryRoots: [...prefs.repositoryRoots, path] })
        setResolutions({})
      }
    } catch (error: unknown) {
      setOpenError(error instanceof Error ? error.message : 'Could not open the folder picker')
    }
  }

  const openFrame = async (frame: StackFrame) => {
    setOpenError('')
    if (!prefs.repositoryRoots.length) {
      setOpenError('Select a repository first — the stack records the build machine path, not this machine.')
      return
    }
    setResolutions((current) => ({ ...current, [frame.index]: 'loading' }))
    const resolution = await resolveFrame(port, prefs.repositoryRoots, frameCandidates(frame))
    setResolutions((current) => ({ ...current, [frame.index]: resolution }))
    if (!resolution.found) return
    const error = await openSourceLocation(port, prefs.repositoryRoots, resolution.path, frame.line, prefs.editorCommand)
    if (error) setOpenError(error)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 bg-surface-1 px-2 py-1">
        <button
          onClick={() => setWrap((value) => !value)}
          title="Word wrap"
          className={cn('grid h-6 w-6 place-items-center rounded border', wrap ? 'border-accent/50 bg-accent/20 text-accent-light' : 'border-border-2 text-text-4 hover:text-text-1')}
        >
          <WrapText size={12} />
        </button>
        <button
          onClick={() => setAppOnly((value) => !value)}
          title="Hide framework and runtime frames"
          className={cn('h-6 rounded border px-2 text-[10px]', appOnly ? 'border-accent/50 bg-accent/20 text-accent-light' : 'border-border-2 text-text-3 hover:text-text-1')}
        >
          App frames only
        </button>
        <button
          onClick={() => copy(stack, 'stack')}
          className="flex h-6 items-center gap-1 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:border-accent/40 hover:text-text-1"
        >
          {copied === 'stack' ? <Check size={11} className="text-success" /> : <Copy size={11} />}
          Copy stack
        </button>
        <span className="ml-auto font-mono text-[10px] text-text-4">{parsed.language} · {parsed.frameCount} frames</span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-1 bg-surface-0 px-2 py-1">
        <button
          onClick={() => void addRepository()}
          title="Choose the local repository that contains this code"
          className="flex h-6 items-center gap-1 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:border-accent/40 hover:text-text-1"
        >
          <FolderPlus size={11} /> Repository
        </button>
        {prefs.repositoryRoots.map((root) => (
          <span key={root} className="flex h-6 items-center gap-1 rounded border border-border-1 bg-surface-1 pl-2 pr-1 font-mono text-[9px] text-text-3" title={root}>
            <span className="max-w-[160px] truncate">{root}</span>
            <button
              onClick={() => { updatePrefs({ repositoryRoots: prefs.repositoryRoots.filter((item) => item !== root) }); setResolutions({}) }}
              title="Remove this repository"
              className="grid h-4 w-4 place-items-center text-text-4 hover:text-error"
            >
              <Trash2 size={9} />
            </button>
          </span>
        ))}
        {prefs.repositoryRoots.length > 0 && (
          <button
            onClick={() => { void reindexRepositories(port); setResolutions({}) }}
            title="Re-scan the repositories after a checkout"
            className="grid h-6 w-6 place-items-center rounded border border-border-2 text-text-4 hover:text-text-1"
          >
            <RefreshCw size={10} />
          </button>
        )}
        <input
          value={prefs.editorCommand}
          onChange={(event) => updatePrefs({ editorCommand: event.target.value })}
          placeholder="Editor command, e.g. code -g {file}:{line}"
          title="{file} and {line} are replaced. Empty uses the system default handler, which cannot jump to a line."
          className="ml-auto h-6 w-[230px] rounded border border-border-2 bg-surface-0 px-2 font-mono text-[10px] text-text-2 outline-none focus:border-accent/50"
        />
      </div>

      {openError && <p className="shrink-0 border-b border-border-1 bg-error/10 px-3 py-1 text-[10px] text-error">{openError}</p>}

      <div className="min-h-0 flex-1 overflow-auto bg-surface-0 py-1">
        {parsed.frameCount === 0 ? (
          <pre className={cn('px-3 py-2 font-mono text-[11px] text-text-2', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>{stack}</pre>
        ) : parsed.sections.map((section, sectionIndex) => {
          const frames = appOnly ? section.frames.filter((frame) => frame.origin === 'application') : section.frames
          return (
            <div key={sectionIndex} className="mb-2">
              <p className={cn('px-2 py-1 font-mono text-[10px]', sectionIndex === 0 ? 'text-error' : 'text-warning')}>{section.title}</p>
              {frames.map((frame) => {
                const resolution = resolutions[frame.index]
                return (
                  <div key={frame.index} className="group flex items-start gap-2 px-2 py-[2px] hover:bg-surface-1">
                    <span className={cn(
                      'mt-[2px] w-9 shrink-0 rounded text-center text-[8px] uppercase',
                      frame.origin === 'application' ? 'bg-accent/15 text-accent-light' : 'bg-surface-2 text-text-4',
                    )} title={frame.originReason || 'Application code'}>
                      {frame.origin === 'application' ? 'app' : 'lib'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('font-mono text-[11px] leading-[1.5] text-text-2', wrap ? 'whitespace-pre-wrap break-words' : 'truncate')}>{frame.raw}</p>
                      {resolution && resolution !== 'loading' && (
                        <p className={cn('font-mono text-[9px]', resolution.found ? 'text-success' : 'text-warning')}>
                          {resolution.found
                            ? `${resolution.path}:${frame.line}${resolution.ambiguous.length ? ` · ${resolution.ambiguous.length} other file(s) match ${resolution.matched}` : ''}`
                            : resolution.error || `No file matching ${frameCandidates(frame)[0]} under the selected repositories — copy the frame instead.`}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => void openFrame(frame)}
                      disabled={resolution === 'loading' || frame.line === 0}
                      title="Resolve this frame in the selected repositories and open it"
                      className="mt-[1px] h-5 shrink-0 rounded border border-border-2 px-1.5 text-[9px] text-text-4 opacity-0 transition-opacity hover:text-text-1 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
                    >
                      {resolution === 'loading' ? '…' : 'Open'}
                    </button>
                    <button
                      onClick={() => copy(frame.raw, `frame-${frame.index}`)}
                      title="Copy this frame"
                      className="mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 opacity-0 transition-opacity hover:text-text-1 group-hover:opacity-100 focus:opacity-100"
                    >
                      {copied === `frame-${frame.index}` ? <Check size={10} className="text-success" /> : <Copy size={10} />}
                    </button>
                  </div>
                )
              })}
              {section.elided > 0 && (
                <p className="px-2 py-[2px] font-mono text-[10px] text-text-4">… {section.elided} frames folded away by the runtime</p>
              )}
              {appOnly && frames.length < section.frames.length && (
                <p className="px-2 py-[2px] font-mono text-[9px] text-text-4">{section.frames.length - frames.length} framework frames hidden</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
