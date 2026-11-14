import { useEffect, useState } from 'react'
import { AppWindow, Bug, Loader2, Play } from 'lucide-react'
import { exportJavaOsgiBundles, listJavaOsgiApps, selectGoIDEFolder, startJavaOsgiApp, type OsgiAppLaunch } from '@/lib/code-studio-api'
import { useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { studioToast } from '@/stores/codeStudioToast'

interface CodeStudioJavaOsgiAppsProps {
  sessionId: string
  /** Chiude il Control Center quando il lancio parte: l'output è nella console Run o nel Debug. */
  onLaunched: () => void
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/** Esegue l'applicazione di un .product/.launch: l'output va nella console Run. */
export function runOsgiApp(sessionId: string, file: string): void {
  useCodeStudioLspStore.getState().showToolWindow('run')
  startJavaOsgiApp(sessionId, file)
    .then((problems) => { if (problems.length > 0) studioToast(`${problems.length} launch problem(s): ${problems[0]}`, 'info') })
    .catch((reason: unknown) => studioToast(messageOf(reason), 'info'))
}

/** Esporta i bundle compilati e i feature in una cartella; con publish anche un repository p2 (console Run). */
export async function exportOsgiBundles(sessionId: string, publish: boolean): Promise<void> {
  const folder = await selectGoIDEFolder(publish ? 'p2 repository folder' : 'Export folder for plugins/ and features/')
  if (!folder) return
  try {
    const result = await exportJavaOsgiBundles(sessionId, folder, publish)
    const exported = result.export
    const count = `${exported?.bundles?.length ?? 0} bundle(s) and ${exported?.features?.length ?? 0} feature(s) exported to ${folder}`
    const problems = exported?.problems ?? []
    if (result.publish) useCodeStudioLspStore.getState().showToolWindow('run')
    studioToast(problems.length > 0 ? `${count}. ${problems.length} problem(s): ${problems[0].project ? `${problems[0].project}: ` : ''}${problems[0].message}` : `${count}${result.publish ? ', publishing the p2 repository' : ''}`, problems.length > 0 ? 'info' : 'success')
  } catch (reason: unknown) {
    studioToast(messageOf(reason), 'info')
  }
}

function describe(app: OsgiAppLaunch): string {
  const what = app.product ? `product ${app.product}` : app.application ? `application ${app.application}` : 'OSGi framework'
  const roots = (app.features?.length ?? 0) > 0 ? `${app.features?.length} feature(s)` : (app.plugins?.length ?? 0) > 0 ? `${app.plugins?.length} plug-in(s)` : 'workspace bundles'
  return `${what} · ${roots}`
}

/** I .product e i .launch PDE del workspace: ognuno si avvia o si debugga come dall'IDE Eclipse. */
export function CodeStudioJavaOsgiApps({ sessionId, onLaunched }: CodeStudioJavaOsgiAppsProps) {
  const [apps, setApps] = useState<OsgiAppLaunch[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    listJavaOsgiApps(sessionId)
      .then((next) => { if (current) setApps(next) })
      .catch((reason: unknown) => { if (current) setError(messageOf(reason)) })
    return () => { current = false }
  }, [sessionId])

  if (error) return <p className="px-3 py-3 text-[12px] text-danger">{error}</p>
  if (!apps) return <p className="flex items-center gap-2 px-3 py-3 text-[12px] text-text-3"><Loader2 size={12} className="animate-spin" /> Reading .product and .launch files…</p>
  if (apps.length === 0) {
    return <p className="px-3 py-3 text-[12px] text-text-3">No .product or Eclipse application .launch file in the workspace projects. Run and Debug above start the workspace bundles in the framework.</p>
  }
  return (
    <ul className="min-h-0 flex-1 overflow-auto py-1">
      {apps.map((app) => (
        <li key={app.file} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-surface-2">
          <AppWindow size={14} className="shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] text-text-1">{app.name} <span className="text-text-4">.{app.kind}</span></div>
            <div className="truncate text-[12px] text-text-3" title={app.file}>{describe(app)} · {app.file}</div>
          </div>
          <button type="button" className="gs-btn shrink-0" onClick={() => { runOsgiApp(sessionId, app.file); onLaunched() }} title={`Start ${app.name} on the project JVM`}><Play size={13} /> Run</button>
          <button type="button" className="gs-btn shrink-0" onClick={() => { void useCodeStudioDebugStore.getState().startOsgi(sessionId, app.file); onLaunched() }} title={`Start ${app.name} waiting for the debugger`}><Bug size={13} /> Debug</button>
        </li>
      ))}
    </ul>
  )
}
