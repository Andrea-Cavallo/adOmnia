import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CloudDownload, HardDrive, Loader2, RefreshCw, Trash2, TriangleAlert, X } from 'lucide-react'
import { cancelGoIDEToolchainInstall, installGoIDEToolchain, listGoIDEToolchainReleases, listInstalledGoIDEToolchains, removeInstalledGoIDEToolchain, selectInstalledGoIDEToolchain, type GoIDEInstalledToolchain, type GoIDEToolchainRelease } from '@/lib/goide-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { confirm } from '@/lib/confirmDialog'
import { useGoIDEStore } from '@/stores/goide'
import type { GoStudioCommandId } from './goStudioCommands'
import { ToolchainConfigSection } from './GoStudioToolchainConfig'
import { ToolchainToolsSection } from './GoStudioToolchainTools'

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
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Go toolchain manager" tabIndex={-1} className="flex max-h-[82vh] w-[720px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center border-b border-border-1 px-4"><h2 className="text-xs font-semibold text-text-1">Go toolchains</h2><span className="ml-2 text-[9px] text-text-4">project-scoped selection</span><button type="button" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error && <div role="alert" className="mb-3 rounded border border-danger/30 bg-danger/10 p-2 text-[10px] text-danger">{error}</div>}
          {info && <dl className="mb-4 grid grid-cols-[76px_1fr_76px_1fr] gap-x-2 gap-y-1 rounded border border-border-1 bg-surface-0 p-2 text-[9px]">{([
            ['Binary', info.goBinary || info.error, true], ['Version', info.version?.replace(/^go version\s+/, ''), false], ['Scope', info.scope === 'project' ? 'This project' : 'Global default', false],
            ['GOROOT', info.goroot, true], ['GOPATH', info.gopath, true], ['GOPROXY', info.goproxy, true], ['GOPRIVATE', info.goprivate, false], ['GONOPROXY', info.gonoproxy, false],
            ['GONOSUMDB', info.gonosumdb, false], ['CGO_ENABLED', info.cgoEnabled, false], ['GOOS/GOARCH', info.goos ? `${info.goos}/${info.goarch}` : '', false], ['GOFLAGS', info.goflags, false],
            ['GOTOOLCHAIN', info.gotoolchain, false], ['go.mod', [info.goDirective && `go ${info.goDirective}`, info.toolchainDirective && `toolchain ${info.toolchainDirective}`].filter(Boolean).join(' · '), false],
          ] as [string, string | undefined, boolean][]).map(([label, value, wide]) => <div key={label} className={`contents`}><dt className="text-text-4">{label}</dt><dd className={`${wide ? 'col-span-3 ' : ''}truncate font-mono text-text-2`} title={value}>{value || '—'}</dd></div>)}</dl>}
          {info?.warning && <div role="status" className="mb-4 flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-[10px] text-text-1"><TriangleAlert size={12} className="mt-px shrink-0 text-warning" />{info.warning}</div>}
          {operation && <div className={`mb-4 rounded border p-3 ${['downloading', 'extracting'].includes(operation.status) ? 'border-accent/30 bg-accent/5' : operation.status === 'failed' ? 'border-danger/30 bg-danger/5' : 'border-border-1 bg-surface-0'}`}><div className="flex items-center gap-2 text-[10px] font-semibold text-text-1">{['downloading', 'extracting'].includes(operation.status) && <Loader2 size={12} className="animate-spin text-accent" />} {operation.version} · {operation.message}{['downloading', 'extracting'].includes(operation.status) && <button type="button" className="ml-auto text-text-3 hover:text-danger" onClick={() => void cancelGoIDEToolchainInstall(operation.id)}>Cancel</button>}</div>{['downloading', 'extracting'].includes(operation.status) && <><div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-3"><div className="h-full bg-accent transition-[width]" style={{ width: operation.totalBytes ? `${Math.min(100, operation.downloadedBytes / operation.totalBytes * 100)}%` : '12%' }} /></div><p className="mt-1 text-[9px] text-text-4">{bytes(operation.downloadedBytes)} / {bytes(operation.totalBytes)}</p></>}<div className="mt-2 max-h-16 overflow-auto font-mono text-[9px] leading-4 text-text-4">{operation.log.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div></div>}
          <section><div className="mb-2 flex items-center"><h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"><HardDrive size={11} /> Installed versions</h3><button type="button" onClick={() => void refreshInstalled()} className="ml-auto grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-3"><RefreshCw size={11} /></button></div><div className="divide-y divide-border-1 rounded border border-border-1 bg-surface-0">{installed.length === 0 && <p className="p-3 text-[10px] text-text-4">No adOmnia-managed toolchains installed.</p>}{installed.map((toolchain) => { const active = info?.goBinary === toolchain.goBinary; return <div key={toolchain.version} className="flex items-center gap-3 p-2"><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 text-[11px] font-medium text-text-2">{toolchain.version}{active && <Check size={11} className="text-success" />}</div><div className="truncate font-mono text-[9px] text-text-4">{toolchain.goBinary}</div></div><button type="button" disabled={active} onClick={() => void activate(toolchain)} className="h-6 rounded px-2 text-[10px] text-accent hover:bg-accent/10 disabled:text-text-4">{active ? 'Active' : 'Use'}</button><button type="button" disabled={active} onClick={() => void remove(toolchain)} title="Remove managed version" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-danger/10 hover:text-danger disabled:opacity-25"><Trash2 size={11} /></button></div>})}</div></section>
          <section className="mt-4"><div className="mb-2 flex items-center"><h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"><CloudDownload size={11} /> Official releases</h3><button type="button" disabled={busy} onClick={() => void loadCatalog()} className="ml-auto flex h-6 items-center gap-1 rounded border border-border-1 px-2 text-[9px] text-text-3 hover:border-accent disabled:opacity-40">{busy ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Load from go.dev</button></div>{releases.length === 0 ? <p className="rounded border border-border-1 bg-surface-0 p-3 text-[10px] text-text-4">The network is contacted only when you load this catalog. Nothing is downloaded automatically.</p> : <div className="max-h-44 divide-y divide-border-1 overflow-auto rounded border border-border-1 bg-surface-0">{releases.map((release) => <div key={release.filename} className="flex items-center gap-3 p-2"><span className="w-24 text-[11px] font-medium text-text-2">{release.version}</span><span className="flex-1 truncate font-mono text-[9px] text-text-4">{release.filename} · {bytes(release.size)}</span><button type="button" onClick={() => void install(release)} className="h-6 rounded px-2 text-[10px] text-accent hover:bg-accent/10">Install…</button></div>)}</div>}</section>
          <ToolchainConfigSection sessionId={sessionId} onError={setError} />
          <ToolchainToolsSection sessionId={sessionId} goAvailable={info?.available === true} onRunCommand={onRunCommand} />
        </div>
      </div>
    </div>
  )
}
