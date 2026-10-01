import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, CloudDownload, Cpu, Download, HardDrive, Loader2, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { cancelGoIDEToolchainInstall, installGoIDEToolchain, listGoIDEToolchainReleases, listInstalledGoIDEToolchains, removeInstalledGoIDEToolchain, selectInstalledGoIDEToolchain, type GoIDEInstalledToolchain, type GoIDEToolchainRelease } from '@/lib/goide-api'
import { confirm } from '@/lib/confirmDialog'
import { useGoIDEStore } from '@/stores/goide'
import type { GoStudioCommandId } from './goStudioCommands'
import { ToolchainConfigSection } from './GoStudioToolchainConfig'
import { ToolchainToolsSection } from './GoStudioToolchainTools'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'

interface ToolchainDialogProps {
  open: boolean
  onClose: () => void
  onRunCommand: (id: GoStudioCommandId) => void
}

function bytes(value: number): string {
  if (!value) return '—'
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function ToolchainDialog({ open, onClose, onRunCommand }: ToolchainDialogProps) {
  const sessionId = useGoIDEStore((state) => state.activeSessionId)
  const info = useGoIDEStore((state) => sessionId ? state.toolchains[sessionId] ?? null : null)
  const installations = useGoIDEStore((state) => state.toolchainInstallations)
  const detectToolchain = useGoIDEStore((state) => state.detectToolchain)
  const [installed, setInstalled] = useState<GoIDEInstalledToolchain[]>([])
  const [releases, setReleases] = useState<GoIDEToolchainRelease[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const operation = useMemo(() => {
    const items = Object.values(installations).filter((item) => item.sessionId === sessionId)
    return items.find((item) => item.status === 'downloading' || item.status === 'extracting') ?? items[items.length - 1] ?? null
  }, [installations, sessionId])

  const refreshInstalled = async () => {
    if (!sessionId) return
    setInstalled(await listInstalledGoIDEToolchains(sessionId))
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    void refreshInstalled().catch((reason) => setError(String(reason)))
  }, [open, sessionId])

  useEffect(() => {
    if (operation?.status === 'installed') void refreshInstalled().catch((reason) => setError(String(reason)))
  }, [operation?.status])

  if (!open || !sessionId) return null

  const loadCatalog = async () => {
    setBusy(true); setError(null)
    try { setReleases(await listGoIDEToolchainReleases(sessionId)) } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const install = async (release: GoIDEToolchainRelease) => {
    const approved = await confirm({ title: `Install ${release.version}?`, message: `Official archive: ${release.filename}\nSize: ${bytes(release.size)}\nSHA-256: ${release.sha256}\n\nThe archive is downloaded from go.dev, verified, and extracted into adOmnia's local toolchain store.`, confirmLabel: 'Download & install' })
    if (!approved) return
    try { await installGoIDEToolchain(sessionId, release.version, true) } catch (reason) { setError(String(reason)) }
  }
  const activate = async (toolchain: GoIDEInstalledToolchain) => {
    try { await selectInstalledGoIDEToolchain(sessionId, toolchain.version); await detectToolchain() } catch (reason) { setError(String(reason)) }
  }
  const remove = async (toolchain: GoIDEInstalledToolchain) => {
    const approved = await confirm({ title: `Remove ${toolchain.version}?`, message: 'This removes only the isolated copy managed by adOmnia. Projects and system Go installations are untouched.', confirmLabel: 'Remove', variant: 'danger' })
    if (!approved) return
    try { await removeInstalledGoIDEToolchain(toolchain.version); await refreshInstalled() } catch (reason) { setError(String(reason)) }
  }

  const installing = !!operation && ['downloading', 'extracting'].includes(operation.status)
  return (
    <GoStudioModal
      open={open}
      onClose={onClose}
      size="lg"
      tall
      divided
      icon={Cpu}
      title="Go SDKs & toolchains"
      subtitle="The Go SDK and environment used by this project. The global default applies to projects without their own."
      footer={<GoStudioButton variant="ghost" onClick={onClose}>Close</GoStudioButton>}
    >
      {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}
      {info?.warning && <GoStudioAlert tone="warning" icon={TriangleAlert}>{info.warning}</GoStudioAlert>}
      {info && (
        <dl className="gs-surface grid grid-cols-[96px_1fr_96px_1fr] gap-x-3 gap-y-1.5 px-3 py-2.5 text-[12px]">
          {([
            ['Binary', info.goBinary || info.error, true], ['Version', info.version?.replace(/^go version\s+/, ''), false], ['Scope', info.scope === 'project' ? 'This project' : 'Global default', false],
            ['GOROOT', info.goroot, true], ['GOPATH', info.gopath, true], ['GOPROXY', info.goproxy, true], ['GOPRIVATE', info.goprivate, false], ['GONOPROXY', info.gonoproxy, false],
            ['GONOSUMDB', info.gonosumdb, false], ['CGO_ENABLED', info.cgoEnabled, false], ['GOOS/GOARCH', info.goos ? `${info.goos}/${info.goarch}` : '', false], ['GOFLAGS', info.goflags, false],
            ['GOTOOLCHAIN', info.gotoolchain, false], ['go.mod', [info.goDirective && `go ${info.goDirective}`, info.toolchainDirective && `toolchain ${info.toolchainDirective}`].filter(Boolean).join(' · '), false],
          ] as [string, string | undefined, boolean][]).map(([label, value, wide]) => (
            <div key={label} className="contents">
              <dt className="text-text-4">{label}</dt>
              <dd className={`${wide ? 'col-span-3 ' : ''}gs-mono truncate text-[11.5px] text-text-2`} title={value}>{value || '—'}</dd>
            </div>
          ))}
        </dl>
      )}
      {info?.available && (
        <div className="gs-surface flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px] text-text-4" title="Detection timings: go env runs in the background and never blocks the IDE">
          {info.cached && <span className="gs-badge text-accent">saved config</span>}
          {(info.timings ?? []).map((timing) => <span key={timing.phase}>{timing.phase} <strong className="gs-mono text-text-2">{timing.ms} ms</strong>{timing.note ? ` (${timing.note})` : ''}</span>)}
          {info.envPending && <span className="inline-flex items-center gap-1 text-text-3"><Loader2 size={11} className="animate-spin" />reading go env in background…</span>}
          {info.envError && <span className="text-warning">{info.envError}</span>}
        </div>
      )}
      {operation && (
        <div className={`gs-alert ${installing ? 'gs-tone-accent' : operation.status === 'failed' ? 'gs-tone-danger' : 'gs-tone-success'} flex-col`}>
          <div className="flex w-full items-center gap-2 font-medium text-text-1">
            {installing && <Loader2 size={14} className="animate-spin" />}
            {operation.version} · {operation.message}
            {installing && <GoStudioButton small variant="ghost" className="ml-auto" onClick={() => void cancelGoIDEToolchainInstall(operation.id)}>Cancel</GoStudioButton>}
          </div>
          {installing && <div className="w-full"><div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: operation.totalBytes ? `${Math.min(100, operation.downloadedBytes / operation.totalBytes * 100)}%` : '12%' }} /></div><p className="mt-1 text-[11.5px] text-text-4">{bytes(operation.downloadedBytes)} / {bytes(operation.totalBytes)}</p></div>}
          {operation.log.length > 0 && <div className="gs-mono max-h-16 w-full overflow-auto text-[11px] leading-4 text-text-4">{operation.log.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div>}
        </div>
      )}
      <section className="flex flex-col gap-2">
        <div className="flex items-center"><h3 className="gs-section-title flex items-center gap-1.5"><HardDrive size={12} /> Installed versions</h3><GoStudioButton small variant="ghost" className="gs-btn-icon ml-auto" onClick={() => void refreshInstalled()} aria-label="Refresh installed versions" title="Refresh"><RefreshCw size={13} /></GoStudioButton></div>
        <div className="gs-list">
          {installed.length === 0 && <p className="gs-list-empty">No adOmnia-managed toolchains installed yet.</p>}
          {installed.map((toolchain) => {
            const active = info?.goBinary === toolchain.goBinary
            return (
              <div key={toolchain.version} className="gs-list-row">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium text-text-1">{toolchain.version}{active && <span className="gs-badge h-[18px] text-[10.5px] text-success"><Check size={11} className="mr-1" />active</span>}</div>
                  <div className="gs-mono truncate text-[11px] text-text-4">{toolchain.goBinary}</div>
                </div>
                {!active && <GoStudioButton small variant="secondary" onClick={() => void activate(toolchain)}>Use</GoStudioButton>}
                <GoStudioButton small variant="danger-ghost" className="gs-btn-icon" disabled={active} onClick={() => void remove(toolchain)} aria-label={`Remove ${toolchain.version}`} title="Remove managed version"><Trash2 size={13} /></GoStudioButton>
              </div>
            )
          })}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <div className="flex items-center"><h3 className="gs-section-title flex items-center gap-1.5"><CloudDownload size={12} /> Official releases</h3><GoStudioButton small variant="secondary" className="ml-auto" icon={RefreshCw} loading={busy} onClick={() => void loadCatalog()}>Load from go.dev</GoStudioButton></div>
        {releases.length === 0
          ? <p className="gs-surface gs-list-empty">The network is contacted only when you load this catalog. Nothing downloads on its own.</p>
          : <div className="gs-list max-h-48">{releases.map((release) => (
              <div key={release.filename} className="gs-list-row">
                <span className="w-24 shrink-0 font-medium text-text-1">{release.version}</span>
                <span className="gs-mono flex-1 truncate text-[11px] text-text-4">{release.filename} · {bytes(release.size)}</span>
                <GoStudioButton small variant="secondary" icon={Download} onClick={() => void install(release)}>Install</GoStudioButton>
              </div>
            ))}</div>}
      </section>
      <ToolchainConfigSection sessionId={sessionId} onError={setError} />
      <ToolchainToolsSection sessionId={sessionId} goAvailable={info?.available === true} onRunCommand={onRunCommand} />
    </GoStudioModal>
  )
}
