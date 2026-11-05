import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw, Search } from 'lucide-react'
import { confirm } from '@/lib/confirmDialog'
import { InstallRipgrep, RipgrepStatus } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import type { RipgrepInfo } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'
import { SettingsCard } from './SettingsLayout'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Global, session-free entry point for the Find in Files engine. ripgrep is bundled in release
 * packages but a portable/dev build can start without it; this card is where the user can see
 * which engine is in use and install the pinned binary without opening Code Studio.
 */
export function SearchEngineSettings() {
  const [info, setInfo] = useState<RipgrepInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setInfo(await RipgrepStatus())
      setError(null)
    } catch (reason) {
      setError(errorText(reason))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const install = async () => {
    const approved = await confirm({
      title: info?.available ? 'Reinstall ripgrep?' : 'Install ripgrep?',
      message: 'adOmnia downloads the pinned ripgrep 14.1.1 into its own tools folder (SHA-256 verified) and uses it for Find in Files. Nothing is written to your project, and the built-in Go search stays available as a fallback.',
      confirmLabel: info?.available ? 'Reinstall' : 'Install',
    })
    if (!approved) return
    setBusy(true)
    setError(null)
    try {
      setInfo(await InstallRipgrep())
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard>
      <div className="flex flex-wrap items-center gap-3">
        <Search size={16} className="shrink-0 text-text-3" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-text-1">Find in Files engine</div>
          <p className="text-[11.5px] text-text-3">ripgrep is the fast search engine; without it adOmnia uses the slower built-in Go search.</p>
          <p className="mt-1 truncate font-mono text-[11px] text-text-4" title={info?.path}>
            {info?.available
              ? `ripgrep ${info.version ?? ''} · ${info.path ?? ''}`
              : info ? 'Not installed · using the built-in Go engine' : 'Checking…'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void install()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded border border-border-2 px-3 py-1 text-xs text-accent disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {info?.available ? 'Reinstall ripgrep' : 'Install ripgrep'}
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          title="Check the engine again"
          aria-label="Check the Find in Files engine again"
          className="rounded border border-border-2 p-1.5 text-text-3 hover:text-text-1"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-[11px] text-danger">{error}</p>}
    </SettingsCard>
  )
}
