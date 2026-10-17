import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { Camera, Loader2, X } from 'lucide-react'
import * as GoIDE from '../../../bindings/adomnia/goide'
import type { RuntimeSnapshotFile } from '../../../bindings/adomnia/internal/goide/models'
import { workspaceServices } from '@/lib/devsession/workspaceFlow'
import { compareSnapshots, type RuntimeSnapshot, type SnapshotDelta } from '@/lib/code-studio/runtimeSnapshot'
import { useDevSessionStore } from '@/stores/devSession'
import { formatBytes } from './CodeStudioBinaryInspector'

export const useSnapshotsDrawer = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }))

function DeltaRows({ title, rows, bytes }: { title: string; rows: SnapshotDelta[]; bytes?: boolean }) {
  if (rows.length === 0) return null
  const show = (value: number) => (bytes ? formatBytes(value) : value.toLocaleString('en-US'))
  return (
    <section className="mt-2">
      <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{title}</h4>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 font-mono text-[11px]">
            <span className="min-w-0 flex-1 truncate text-text-2" title={row.label}>{row.label}</span>
            <span className="text-text-4">{show(row.before)} → {show(row.after)}</span>
            <span className={row.after > row.before ? 'text-danger' : 'text-success'}>{row.after > row.before ? '+' : ''}{bytes ? formatBytes(row.after - row.before) : (row.after - row.before).toLocaleString('en-US')}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Runtime Snapshot: save goroutines, heap, requests, messages, SQL, logs and traces of a running service, then compare two. */
export function CodeStudioSnapshots({ sessionId }: { sessionId: string }) {
  const { open, setOpen } = useSnapshotsDrawer()
  const sessions = useDevSessionStore((state) => state.sessions)
  const services = useMemo(() => workspaceServices(sessions, sessionId), [sessions, sessionId])
  const [service, setService] = useState('')
  const [label, setLabel] = useState('')
  const [files, setFiles] = useState<RuntimeSnapshotFile[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pair, setPair] = useState<[string, string]>(['', ''])
  const [comparison, setComparison] = useState<ReturnType<typeof compareSnapshots> | null>(null)
  const refresh = async () => setFiles((await GoIDE.ListRuntimeSnapshots(sessionId)) ?? [])
  useEffect(() => { if (open) void refresh() }, [open, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!services.some((item) => item.id === service)) setService(services[0]?.id ?? '') }, [services, service])
  useEffect(() => {
    if (files.length >= 2 && !pair[0]) setPair([files[1].name, files[0].name])
  }, [files, pair])
  if (!open) return null
  const take = async () => {
    const live = services.find((item) => item.id === service)
    if (!live) return
    setBusy(true)
    setMessage(null)
    try {
      const { takeRuntimeSnapshot } = await import('@/lib/code-studio/runtimeSnapshotCapture')
      const { snapshot, warnings } = await takeRuntimeSnapshot(sessionId, live, label.trim() || live.service)
      const name = await GoIDE.SaveRuntimeSnapshot(sessionId, label.trim() || live.service, JSON.stringify(snapshot, null, 2))
      setMessage(`Saved .adomnia/snapshots/${name}${warnings.length ? ` — ${warnings.join('; ')}` : ''}`)
      await refresh()
    } catch (problem) { setMessage(problem instanceof Error ? problem.message : String(problem)) } finally { setBusy(false) }
  }
  const compare = async () => {
    try {
      const [before, after] = await Promise.all(pair.map((name) => GoIDE.LoadRuntimeSnapshot(sessionId, name)))
      setComparison(compareSnapshots(JSON.parse(before) as RuntimeSnapshot, JSON.parse(after) as RuntimeSnapshot))
    } catch (problem) { setMessage(problem instanceof Error ? problem.message : String(problem)) }
  }
  return (
    <aside aria-label="Runtime snapshots" className="fixed bottom-12 right-3 top-12 z-[300] flex w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-border-2 bg-surface-1 text-[11.5px] shadow-2xl shadow-black/50">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 px-3">
        <Camera size={14} className="text-accent" />
        <span className="font-semibold text-text-1">Runtime snapshots</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={13} /></button>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 px-3 py-2">
        {services.length === 0 ? <span className="text-text-4">Start the service (Run or Start Workspace) to take a snapshot.</span> : (
          <>
            <select aria-label="Service" value={service} onChange={(event) => setService(event.target.value)} className="h-7 rounded border border-border-2 bg-surface-2 px-1 text-text-1">
              {services.map((item) => <option key={item.id} value={item.id}>{item.service}{item.port ? ` :${item.port}` : ''}</option>)}
            </select>
            <input aria-label="Snapshot label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="label, e.g. before load test" className="h-7 w-48 rounded border border-border-2 bg-surface-2 px-1.5 text-text-1 outline-none focus:border-accent" />
            <button type="button" onClick={() => void take()} disabled={busy} className="flex h-7 items-center gap-1 rounded bg-accent px-2.5 font-semibold text-on-accent hover:opacity-90 disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}Take snapshot</button>
          </>
        )}
      </div>
      {message && <p className="shrink-0 border-b border-border-1 px-3 py-1 text-text-3">{message}</p>}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-4">Compare</span>
          {[0, 1].map((side) => (
            <select key={side} aria-label={side === 0 ? 'Before' : 'After'} value={pair[side]} onChange={(event) => setPair(side === 0 ? [event.target.value, pair[1]] : [pair[0], event.target.value])} className="h-7 max-w-56 rounded border border-border-2 bg-surface-2 px-1 font-mono text-text-1">
              <option value="">{side === 0 ? 'before…' : 'after…'}</option>
              {files.map((file) => <option key={file.name} value={file.name}>{file.name}</option>)}
            </select>
          ))}
          <button type="button" onClick={() => void compare()} disabled={!pair[0] || !pair[1] || pair[0] === pair[1]} className="h-7 rounded px-2 text-accent hover:bg-accent/10 disabled:opacity-40">Compare</button>
        </div>
        {files.length === 0 && <p className="mt-2 text-text-4">No snapshot yet. They are saved in .adomnia/snapshots and can be committed.</p>}
        {comparison && (
          <div aria-label="Snapshot comparison" className="mt-3">
            <DeltaRows title="Summary" rows={comparison.summary.filter((row) => row.before !== row.after)} />
            <DeltaRows title="Goroutines by function" rows={comparison.goroutines} />
            <DeltaRows title="Heap in use by function" rows={comparison.heap} bytes />
            {comparison.newErrors.length > 0 && (
              <section className="mt-2"><h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">New error lines</h4>{comparison.newErrors.map((line) => <p key={line} className="truncate font-mono text-[11px] text-danger" title={line}>{line}</p>)}</section>
            )}
            {comparison.summary.every((row) => row.before === row.after) && comparison.goroutines.length === 0 && comparison.heap.length === 0 && <p className="text-text-3">Nothing changed between the two snapshots.</p>}
          </div>
        )}
      </div>
    </aside>
  )
}
