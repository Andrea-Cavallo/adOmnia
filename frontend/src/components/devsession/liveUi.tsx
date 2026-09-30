import type { LiveSession, RequestRun } from '@/lib/devsession-api'
import { cn } from '@/lib/utils'

/**
 * One visual language for live state across adOmnia: a single dot, never a
 * badge wall. Green running, yellow paused at a breakpoint, red error,
 * accent (violet) linked to the active development session.
 */
export function LiveDot({ session, className }: { session: Pick<LiveSession, 'state'>; className?: string }) {
  const tone = session.state === 'paused' ? 'bg-warning'
    : session.state === 'error' ? 'bg-error'
      : session.state === 'starting' ? 'bg-text-4 animate-pulse'
        : session.state === 'stopped' ? 'bg-text-4'
          : 'bg-success'
  return <span aria-hidden="true" className={cn('inline-block h-2 w-2 shrink-0 rounded-full', tone, className)} />
}

/** Accent dot: this element belongs to the active development session. */
export function LinkedDot({ className, title }: { className?: string; title?: string }) {
  return <span aria-hidden={!title} title={title} className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent', className)} />
}

export function stateLabel(session: Pick<LiveSession, 'state' | 'kind'>): string {
  switch (session.state) {
    case 'paused': return 'Paused'
    case 'starting': return 'Starting'
    case 'error': return 'Error'
    case 'stopped': return 'Stopped'
    default: return session.kind === 'debug' ? 'Debugging' : 'Running'
  }
}

export function runLabel(run: RequestRun): string {
  switch (run.state) {
    case 'paused': return 'Paused at breakpoint'
    case 'sent': return 'In flight'
    case 'error': return run.error || 'Failed'
    default: return `${run.status ?? ''} · ${run.durationMs ?? 0} ms`
  }
}

export const basename = (path: string) => path.split(/[\\/]/).pop() || path
