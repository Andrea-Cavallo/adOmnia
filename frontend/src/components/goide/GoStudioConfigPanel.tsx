import { useEffect, useMemo, useState } from 'react'
import { GitCompare, RefreshCw } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { useDevContextStore } from '@/stores/devcontext'
import { useGoIDEStore } from '@/stores/goide'
import { configReport, profileDiff, profileName, type ConfigStatus } from '@/lib/goide/configReport'
import { cn } from '@/lib/utils'

const STATUS: Record<ConfigStatus, { label: string; tone: string; hint: string }> = {
  missing: { label: 'missing', tone: 'bg-error/10 text-error', hint: 'Read by the code but defined in no .env file: it must come from the shell or the deployment' },
  partial: { label: 'not in every profile', tone: 'bg-warning/10 text-warning', hint: 'Read by the code but absent from some .env profiles' },
  unused: { label: 'unused', tone: 'bg-surface-3 text-text-3', hint: 'Defined in a .env file but never read by the code' },
  ok: { label: 'ok', tone: 'bg-success/10 text-success', hint: 'Read by the code and defined in every profile' },
}

function openSource(file: string, line: number): void {
  void useGoIDEStore.getState().openLocation(file, line || 1, 1)
}

/** Config & environment: variables the code reads against the .env profiles that define them. */
export function GoStudioConfigPanel({ session }: { session: GoIDESession }) {
  const snapshot = useDevContextStore((state) => state.snapshots[session.id])
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<ConfigStatus | 'all'>('all')
  const [compare, setCompare] = useState<[string, string] | null>(null)

  useEffect(() => { void useDevContextStore.getState().ensure(session.id) }, [session.id])
  const report = useMemo(() => configReport(snapshot?.entities ?? []), [snapshot])
  const keys = filter === 'all' ? report.keys : report.keys.filter((key) => key.status === filter)
  const diff = compare ? profileDiff(report, compare[0], compare[1]) : []

  const rescan = async () => {
    setBusy(true)
    try { await useDevContextStore.getState().rescan(session.id) } finally { setBusy(false) }
  }

  if (!snapshot) return <p className="p-3 text-text-4">Scanning the project…</p>
  if (!report.keys.length) {
    return <p className="p-3 text-text-4">No environment variables found: the code reads none with os.Getenv / LookupEnv or env struct tags, and there is no .env file.</p>
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border-1 px-2 py-1">
        <button type="button" onClick={() => setFilter('all')} className={cn('rounded px-1.5 py-0.5', filter === 'all' ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3')}>All {report.keys.length}</button>
        {(Object.keys(STATUS) as ConfigStatus[]).filter((status) => report.counts[status]).map((status) => (
          <button key={status} type="button" title={STATUS[status].hint} onClick={() => setFilter(filter === status ? 'all' : status)} className={cn('rounded px-1.5 py-0.5', STATUS[status].tone, filter === status && 'ring-1 ring-current')}>
            {STATUS[status].label} {report.counts[status]}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-text-4">
          {report.profiles.length >= 2 && (
            <button type="button" onClick={() => setCompare(compare ? null : [report.profiles[0], report.profiles[1]])} className={cn('flex items-center gap-1 rounded px-1.5 py-0.5', compare ? 'bg-accent/15 text-accent' : 'hover:bg-surface-3')}>
              <GitCompare size={11} aria-hidden="true" /> Compare profiles
            </button>
          )}
          <button type="button" onClick={() => void rescan()} disabled={busy} title="Rescan the project" className="grid h-6 w-6 place-items-center rounded hover:bg-surface-3 disabled:opacity-50">
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </span>
      </div>

      {compare ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-text-3">
            {[0, 1].map((side) => (
              <select key={side} value={compare[side]} onChange={(event) => setCompare(side === 0 ? [event.target.value, compare[1]] : [compare[0], event.target.value])} className="rounded border border-border-2 bg-surface-2 px-1.5 py-0.5 text-text-1">
                {report.profiles.map((profile) => <option key={profile} value={profile}>{profileName(profile)} ({profile})</option>)}
              </select>
            ))}
            <span className="text-text-4">{diff.length} differences · secrets compare masked</span>
          </div>
          <table className="w-full text-left text-[11px]">
            <thead className="text-[10px] uppercase tracking-wide text-text-4"><tr><th className="px-2 py-1 font-medium">Key</th><th className="px-2 py-1 font-medium">{profileName(compare[0])}</th><th className="px-2 py-1 font-medium">{profileName(compare[1])}</th></tr></thead>
            <tbody>{diff.map((row) => (
              <tr key={row.name} className="border-t border-border-1">
                <td className="px-2 py-1 font-mono text-text-1">{row.name}</td>
                <td className={cn('px-2 py-1 font-mono', row.left === undefined ? 'text-error' : 'text-text-2')}>{row.left ?? '— not set'}</td>
                <td className={cn('px-2 py-1 font-mono', row.right === undefined ? 'text-error' : 'text-text-2')}>{row.right ?? '— not set'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-surface-1 text-[10px] uppercase tracking-wide text-text-4">
              <tr>
                <th className="px-2 py-1 font-medium">Key</th>
                <th className="px-2 py-1 font-medium">Status</th>
                <th className="px-2 py-1 font-medium">Read in code</th>
                {report.profiles.map((profile) => <th key={profile} className="px-2 py-1 font-medium" title={profile}>{profileName(profile)}</th>)}
              </tr>
            </thead>
            <tbody>{keys.map((key) => (
              <tr key={key.name} className="border-t border-border-1 align-top hover:bg-surface-2">
                <td className="px-2 py-1 font-mono text-text-1">{key.name}</td>
                <td className="px-2 py-1"><span title={STATUS[key.status].hint} className={cn('rounded px-1.5 py-0.5 text-[10px]', STATUS[key.status].tone)}>{STATUS[key.status].label}</span></td>
                <td className="px-2 py-1">
                  {key.usedIn.length ? key.usedIn.map((source, index) => (
                    <button key={index} type="button" onClick={() => openSource(source.file, source.line)} className="mr-2 font-mono text-text-2 hover:text-accent hover:underline">{source.file}:{source.line}</button>
                  )) : <span className="text-text-4">—</span>}
                </td>
                {report.profiles.map((profile) => {
                  const defined = key.definedIn.find((source) => source.file === profile)
                  return (
                    <td key={profile} className="px-2 py-1 font-mono">
                      {defined
                        ? <button type="button" onClick={() => openSource(defined.file, defined.line)} className="max-w-[220px] truncate text-text-2 hover:text-accent hover:underline">{key.values[profile] || '""'}</button>
                        : <span className={key.missingIn.includes(profile) ? 'text-warning' : 'text-text-4'}>—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
