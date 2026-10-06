import { useState } from 'react'
import { Check, Loader2, RefreshCw, Settings2, TriangleAlert } from 'lucide-react'
import { listInstalledGoIDEToolchains, selectInstalledGoIDEToolchain, type GoIDEInstalledToolchain, type GoIDEToolchainInfo } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'

interface Props {
  sessionId: string
  toolchain: GoIDEToolchainInfo | null
  className: string
  onManage: () => void
}

/** Cambio rapido dell'SDK del progetto dalla status bar, tra le versioni gestite da adOmnia. */
export function GoStudioToolchainSwitcher({ sessionId, toolchain, className, onManage }: Props) {
  const [open, setOpen] = useState(false)
  const [installed, setInstalled] = useState<GoIDEInstalledToolchain[] | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const label = toolchain?.available ? (toolchain.version ?? 'Go ready').replace(/^go version\s+/, '').split(' ')[0] : 'Go not detected'

  const toggle = () => {
    const next = !open
    setOpen(next)
    setError(null)
    if (next) void listInstalledGoIDEToolchains(sessionId).then(setInstalled).catch((reason) => { setInstalled([]); setError(String(reason)) })
  }
  const select = async (version: string) => {
    setSwitching(version)
    try {
      await selectInstalledGoIDEToolchain(sessionId, version)
      await useGoIDEStore.getState().detectToolchain()
      await useGoIDELspStore.getState().refreshAfterToolchainChange(sessionId)
      setOpen(false)
    } catch (reason) { setError(String(reason)) } finally { setSwitching(null) }
  }

  return (
    <div className="relative">
      <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} title={toolchain?.warning ?? toolchain?.goBinary ?? 'Select Go SDK'} className={`${className} ${toolchain?.warning ? 'text-warning' : ''}`}>
        {toolchain?.warning && <TriangleAlert size={11} />}{label}
      </button>
      {open && <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div role="menu" className="absolute bottom-full right-0 z-50 mb-1 w-64 overflow-hidden rounded-md border border-border-2 bg-surface-1 py-1 text-[11px] shadow-xl">
          <div className="px-3 pb-1 pt-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-4">Go SDK for this project</div>
          {installed === null && <div className="flex items-center gap-2 px-3 py-1.5 text-text-4"><Loader2 size={11} className="animate-spin" /> Loading…</div>}
          {installed?.length === 0 && <div className="px-3 py-1.5 text-text-4">No managed SDKs installed yet.</div>}
          {installed?.map((item) => {
            const active = toolchain?.goBinary === item.goBinary
            return (
              <button key={item.version} type="button" role="menuitem" disabled={active || switching !== null} onClick={() => void select(item.version)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-2 hover:bg-surface-3 disabled:cursor-default disabled:hover:bg-transparent">
                <span className="w-3">{active ? <Check size={11} className="text-success" /> : switching === item.version ? <Loader2 size={11} className="animate-spin" /> : null}</span>{item.version}
              </button>
            )
          })}
          {error && <div role="alert" className="px-3 py-1 text-[10px] text-danger">{error}</div>}
          <div className="my-1 border-t border-border-1" />
          <button type="button" role="menuitem" onClick={() => { setOpen(false); void useGoIDEStore.getState().detectToolchain().then(() => useGoIDELspStore.getState().refreshAfterToolchainChange(sessionId)) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-2 hover:bg-surface-3"><RefreshCw size={11} className="text-text-4" /> Reload Go and gopls</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onManage() }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-2 hover:bg-surface-3"><Settings2 size={11} className="text-text-4" /> Install or manage Go…</button>
        </div>
      </>}
    </div>
  )
}
