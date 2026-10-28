import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Terminal } from 'lucide-react'
import { CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import {
  getRustToolchains,
  installRustComponent,
  installRustToolchain,
  setRustToolchain,
  type GoIDERustToolchain,
} from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import type { RustToolchainReport } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'

let openRequest: ((sessionId: string) => void) | null = null

/** Apre la scelta della toolchain Rust del progetto. */
export function openRustToolchainDialog(sessionId: string): void {
  openRequest?.(sessionId)
}

/** Componenti rustup installabili con un comando visibile, utili all'editor e al lint. */
const INSTALLABLE_COMPONENTS = [
  { id: 'rust-src', label: 'rust-src', why: 'lets rust-analyzer open the standard library sources' },
  { id: 'clippy', label: 'clippy', why: 'enables the clippy run kind and lints' },
] as const

/**
 * Toolchain Rust del progetto: Run, Debug, Test e rust-analyzer usano lo stesso cargo. Con il
 * progetto autorizzato si vede la versione dal probe `rustc -vV`; componenti e toolchain si
 * installano solo dopo conferma del comando rustup esatto, mai in automatico.
 */
export function CodeStudioRustToolchain() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [report, setReport] = useState<RustToolchainReport | null>(null)
  const [manualPath, setManualPath] = useState('')
  const [channel, setChannel] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (id: string) => {
    setReport(await getRustToolchains(id))
  }, [])

  useEffect(() => {
    openRequest = (id) => {
      setSessionId(id)
      setReport(null)
      setManualPath('')
      setChannel('')
      setError('')
      load(id).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
    }
    return () => { openRequest = null }
  }, [load])

  const choose = async (path: string) => {
    if (!sessionId) return
    setBusy(path || 'automatic')
    try {
      await setRustToolchain(sessionId, path)
      await load(sessionId)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  const showRunConsole = () => {
    useCodeStudioStore.getState().updateLayout({ bottomOpen: true })
    useCodeStudioLspStore.getState().showToolWindow('run')
  }

  const installComponent = async (component: string) => {
    if (!sessionId) return
    if (!window.confirm(`Install the ${component} component?\n\nrustup component add ${component}\n\n${INSTALLABLE_COMPONENTS.find((c) => c.id === component)?.why}. Output appears in the Run console.`)) return
    setBusy(component)
    try {
      await installRustComponent(sessionId, component, true)
      showRunConsole()
      await load(sessionId)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  const installToolchain = async () => {
    if (!sessionId || channel.trim() === '') return
    if (!window.confirm(`Install the ${channel.trim()} toolchain?\n\nrustup toolchain install ${channel.trim()}\n\nOutput appears in the Run console. The default toolchain is never changed.`)) return
    setBusy('toolchain')
    try {
      await installRustToolchain(sessionId, channel.trim(), true)
      showRunConsole()
      await load(sessionId)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  const rows = report
    ? [
      { path: '', title: 'Automatic (project toolchain or PATH)', detail: 'adOmnia picks rust-toolchain.toml, RUSTUP_TOOLCHAIN or the PATH', toolchain: null },
      ...report.installed.map((toolchain: GoIDERustToolchain) => ({
        path: toolchain.cargo,
        title: toolchain.version ? `Rust ${toolchain.version}` : 'cargo',
        detail: [toolchain.cargo, toolchain.source, toolchain.host].filter(Boolean).join(' · '),
        toolchain,
      })),
    ]
    : []

  return (
    <CodeStudioModal
      open={!!sessionId}
      onClose={() => setSessionId(null)}
      title="Project Rust Toolchain"
      subtitle={report?.channel ? `The project declares the ${report.channel} toolchain` : 'The project does not declare a toolchain'}
      icon={Terminal}
      size="lg"
      divided
      flush
      top
    >
      <div className="gs-list max-h-[60vh] overflow-auto">
        {!report && !error && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Looking for Rust toolchains…</p>}
        {rows.map((row) => {
          const selected = (report?.selected ?? '') === row.path
          return (
            <div key={row.path || 'automatic'} className="gs-list-row">
              <button type="button" disabled={busy !== ''} onClick={() => void choose(row.path)} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60">
                <span className="grid w-4 shrink-0 place-items-center text-success">{selected ? <Check size={13} /> : null}</span>
                <span className="w-40 shrink-0 text-[12px] text-text-1">{row.title}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-3">{row.detail}</span>
                {row.toolchain?.problem && <span className="gs-badge shrink-0 text-warning" title={row.toolchain.problem}>no probe</span>}
                {!report?.probed && row.toolchain && <span className="gs-badge shrink-0">not trusted</span>}
              </button>
            </div>
          )
        })}
        {report && report.installed.length === 0 && <p className="px-3 py-3 text-[11px] text-text-4">No Rust toolchain found. Install Rust (rustup) or set the PATH.</p>}
      </div>
      <div className="border-t border-border-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            aria-label="Cargo path"
            value={manualPath}
            onChange={(event) => setManualPath(event.target.value)}
            placeholder="C:\\Users\\you\\.cargo\\bin\\cargo.exe"
            className="gs-input min-w-0 flex-1 font-mono text-[11px]"
          />
          <CodeStudioButton small variant="ghost" disabled={busy !== '' || manualPath.trim() === ''} onClick={() => void choose(manualPath.trim())}>
            Use this cargo
          </CodeStudioButton>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-text-4">
          {INSTALLABLE_COMPONENTS.map((component) => (
            <CodeStudioButton key={component.id} small variant="ghost" disabled={busy !== ''} onClick={() => void installComponent(component.id)}>
              {busy === component.id ? <Loader2 size={12} className="animate-spin" /> : null} Install {component.label}…
            </CodeStudioButton>
          ))}
          <span className="flex items-center gap-1">
            <input
              aria-label="Toolchain channel"
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              placeholder="1.85.0"
              className="gs-input w-28 font-mono text-[11px]"
            />
            <CodeStudioButton small variant="ghost" disabled={busy !== '' || channel.trim() === ''} onClick={() => void installToolchain()}>
              {busy === 'toolchain' ? <Loader2 size={12} className="animate-spin" /> : null} Install toolchain…
            </CodeStudioButton>
          </span>
        </div>
      </div>
      {error && <p className="border-t border-border-1 px-3 py-2 text-[11px] text-danger">{error}</p>}
      <p className="border-t border-border-1 px-3 py-2 text-[10.5px] text-text-4">
        Saved in .adomnia/rust.local.json (not shared via Git). Run, Debug, Test and rust-analyzer use the same cargo.
        {!report?.probed && ' Trust the project to check versions.'}
      </p>
    </CodeStudioModal>
  )
}
