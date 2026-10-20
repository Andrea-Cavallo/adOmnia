import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, CircleDashed, Download, Loader2, RefreshCw } from 'lucide-react'
import { confirm } from '@/lib/confirmDialog'
import { subscribeGoIDEEvents } from '@/lib/code-studio-api'
import { useIdeLanguageServersStore } from '@/stores/ideLanguageServers'
import { showInstallOutput } from '@/stores/codeStudioToolInstall'
import { studioToast } from '@/stores/codeStudioToast'
import { CodeStudioAlert, CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import {
  INSTALLER_GROUPS, INSTALLER_TOOLS, detectInstallerStatus, finishInstall, installerCommand, startInstall,
  type InstallerStatus, type InstallerTool,
} from './codeStudioInstallerTools'

interface CodeStudioInstallerProps {
  open: boolean
  sessionId: string
  trusted: boolean
  onClose: () => void
}

/** Every download adOmnia can ask for, in one place: pick what you want, confirm the exact commands once. */
export function CodeStudioInstaller({ open, sessionId, trusted, onClose }: CodeStudioInstallerProps) {
  const [status, setStatus] = useState<Record<string, InstallerStatus>>({})
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set())
  // runId → tool id, for the go tools that report completion through the shared run.finished event.
  const runs = useRef(new Map<string, string>())
  const serverInstalls = useIdeLanguageServersStore((state) => state.installing[sessionId])

  const detect = useCallback(async () => {
    setLoading(true)
    try { setStatus(await detectInstallerStatus(sessionId)) } finally { setLoading(false) }
  }, [sessionId])

  useEffect(() => { if (open) void detect() }, [open, detect])

  useEffect(() => {
    if (!open) return undefined
    return subscribeGoIDEEvents((event) => {
      if (event.sessionId !== sessionId || event.type !== 'run.finished') return
      const execution = event.payload as { id?: string; exitCode?: number | null; status?: string } | undefined
      const toolId = execution?.id ? runs.current.get(execution.id) : undefined
      if (toolId) {
        runs.current.delete(execution!.id!)
        finishInstall(sessionId, toolId, execution?.exitCode === 0 || execution?.status === 'exited')
        setRunning((current) => new Set([...current].filter((id) => id !== toolId)))
      }
      void detect()
    })
  }, [open, sessionId, detect])

  const missing = useMemo(() => INSTALLER_TOOLS.filter((tool) => status[tool.id] && !status[tool.id].available && status[tool.id].installable), [status])
  const isBusy = (tool: InstallerTool) => running.has(tool.id) || (tool.source.kind === 'server' && !!serverInstalls?.[tool.source.language])
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  const chosen = INSTALLER_TOOLS.filter((tool) => picked.has(tool.id) && missing.includes(tool) && !isBusy(tool))

  const installChosen = async () => {
    const commands = await Promise.all(chosen.map(async (tool) => `• ${await installerCommand(sessionId, tool).catch((error: unknown) => String(error))}  (${tool.name})`))
    const approved = await confirm({
      title: `Install ${chosen.length} tool${chosen.length === 1 ? '' : 's'}?`,
      message: `Commands:\n${commands.join('\n')}\n\nEverything is downloaded into adOmnia's own tools folder, never into your project. Output appears in the Run console.`,
      confirmLabel: 'Install',
    })
    if (!approved) return
    setPicked(new Set())
    showInstallOutput()
    for (const tool of chosen) {
      setRunning((current) => new Set(current).add(tool.id))
      const clear = () => { setRunning((current) => new Set([...current].filter((id) => id !== tool.id))); void detect() }
      try {
        const runId = await startInstall(sessionId, tool, clear)
        if (runId) runs.current.set(runId, tool.id)
        else if (tool.source.kind === 'server') clear()
      } catch (error) {
        clear()
        studioToast(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`, 'info')
      }
    }
  }

  return (
    <CodeStudioModal
      open={open} onClose={onClose} icon={Download} size="lg" tall divided
      title="Installer" subtitle="Language servers, linters, debugger and security tools — one place, nothing installed without your confirmation."
      actions={<CodeStudioButton small variant="ghost" icon={RefreshCw} loading={loading} onClick={() => void detect()} title="Check what is installed again">Refresh</CodeStudioButton>}
      footerStart={<CodeStudioButton small variant="ghost" disabled={!missing.length} onClick={() => setPicked(new Set(missing.map((tool) => tool.id)))}>Select all missing ({missing.length})</CodeStudioButton>}
      footer={<CodeStudioButton variant="primary" icon={Download} disabled={!trusted || !chosen.length} onClick={() => void installChosen()}>Install selected ({chosen.length})</CodeStudioButton>}
    >
      {!trusted && <CodeStudioAlert tone="warning">Trust this project to install tools: installs run commands on this machine.</CodeStudioAlert>}
      {INSTALLER_GROUPS.map((group) => (
        <section key={group.id} className="mt-3 space-y-1">
          <h4 className="gs-section-title">{group.label} <span className="font-normal text-text-4">· {group.hint}</span></h4>
          <div className="gs-list">
            {INSTALLER_TOOLS.filter((tool) => tool.group === group.id).map((tool) => {
              const info = status[tool.id]
              const busy = isBusy(tool)
              const canPick = !!info && !info.available && !!info.installable && !busy
              return (
                <label key={tool.id} className="gs-list-row items-center gap-3">
                  <input type="checkbox" className="accent-accent" aria-label={`Select ${tool.name}`} disabled={!canPick || !trusted} checked={picked.has(tool.id)} onChange={() => toggle(tool.id)} />
                  {busy ? <Loader2 size={14} className="shrink-0 animate-spin text-accent" /> : info?.available ? <CheckCircle2 size={14} className="shrink-0 text-success" /> : <CircleDashed size={14} className="shrink-0 text-text-4" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-text-1">{tool.name} <span className="font-normal text-text-4">· {tool.purpose}</span></div>
                    <div className="gs-mono truncate text-[11px] text-text-4" title={info?.detail ?? info?.error}>
                      {busy ? 'Installing… see the Run console' : info?.available ? info.detail || 'Installed' : info?.error || (info ? 'Not installed' : 'Checking…')}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </section>
      ))}
    </CodeStudioModal>
  )
}
