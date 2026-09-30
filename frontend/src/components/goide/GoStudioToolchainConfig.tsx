import { useEffect, useState } from 'react'
import { Globe, FolderGit2, Loader2 } from 'lucide-react'
import { configureGoIDEGlobalToolchain, getGoIDEToolchainSettings, resetGoIDEToolchainToGlobal, type GoIDEToolchainSettings } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { toolchainEnvFromForm, toolchainFormFromEnv, type ToolchainField, type ToolchainForm } from './goStudioToolchainEnv'

type Scope = 'project' | 'global'

const inputClass = 'mt-1 h-7 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent'

const TEXT_FIELDS: { key: ToolchainField; label: string; placeholder: string }[] = [
  { key: 'GOPROXY', label: 'GOPROXY', placeholder: 'https://proxy.golang.org,direct' },
  { key: 'GOPRIVATE', label: 'GOPRIVATE', placeholder: 'git.example.com/*' },
  { key: 'GONOPROXY', label: 'GONOPROXY', placeholder: 'defaults to GOPRIVATE' },
  { key: 'GONOSUMDB', label: 'GONOSUMDB', placeholder: 'defaults to GOPRIVATE' },
  { key: 'GOOS', label: 'GOOS', placeholder: 'host OS (linux, windows, darwin…)' },
  { key: 'GOARCH', label: 'GOARCH', placeholder: 'host arch (amd64, arm64…)' },
]

interface Props {
  sessionId: string
  onError: (message: string | null) => void
}

/** Toolchain del progetto o predefinita globale: binario Go, proxy/privacy dei moduli, CGO, cross-compilazione e build tags. */
export function ToolchainConfigSection({ sessionId, onError }: Props) {
  const configureToolchain = useGoIDEStore((state) => state.configureToolchain)
  const detectToolchain = useGoIDEStore((state) => state.detectToolchain)
  const [settings, setSettings] = useState<GoIDEToolchainSettings | null>(null)
  const [scope, setScope] = useState<Scope>('project')
  const [goBinary, setGoBinary] = useState('')
  const [form, setForm] = useState<ToolchainForm>(() => toolchainFormFromEnv({}))
  const [busy, setBusy] = useState(false)

  const load = async (nextScope: Scope, current = settings) => {
    const config = nextScope === 'project' ? current?.project ?? current?.global : current?.global
    setGoBinary(config?.goBinary ?? '')
    setForm(toolchainFormFromEnv(config?.environment))
  }

  useEffect(() => {
    void getGoIDEToolchainSettings(sessionId).then((loaded) => {
      setSettings(loaded)
      const initial: Scope = loaded.project ? 'project' : 'global'
      setScope(initial)
      void load(initial, loaded)
    }).catch((reason) => onError(String(reason)))
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => setSettings(await getGoIDEToolchainSettings(sessionId))
  const setField = (key: ToolchainField, value: string) => setForm((current) => ({ ...current, fields: { ...current.fields, [key]: value } }))
  const switchScope = (next: Scope) => { setScope(next); void load(next) }

  const save = async () => {
    setBusy(true); onError(null)
    try {
      const environment = toolchainEnvFromForm(form)
      if (scope === 'project') {
        if (!await configureToolchain(goBinary, environment)) onError('The configured Go binary could not be validated.')
      } else {
        await configureGoIDEGlobalToolchain({ goBinary, environment })
        await detectToolchain()
      }
      await refresh()
    } catch (reason) { onError(String(reason)) } finally { setBusy(false) }
  }
  const useGlobal = async () => {
    setBusy(true); onError(null)
    try { await resetGoIDEToolchainToGlobal(sessionId); await refresh(); await detectToolchain(); switchScope('global') } catch (reason) { onError(String(reason)) } finally { setBusy(false) }
  }

  const scopeButton = (value: Scope, label: string, Icon: typeof Globe) => (
    <button type="button" aria-pressed={scope === value} onClick={() => switchScope(value)} className={`flex h-6 items-center gap-1 rounded px-2 text-[10px] ${scope === value ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3'}`}><Icon size={11} />{label}</button>
  )

  return (
    <section className="mt-4 border-t border-border-1 pt-4">
      <div className="mb-2 flex items-center gap-1">
        <h3 className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-text-3">Configuration</h3>
        {scopeButton('project', 'This project', FolderGit2)}
        {scopeButton('global', 'Global default', Globe)}
        <span className="ml-auto text-[9px] text-text-4">{settings?.project ? 'Project overrides the global default' : 'Project follows the global default'}</span>
      </div>
      <label className="block text-[10px] text-text-3">Go binary<input value={goBinary} onChange={(event) => setGoBinary(event.target.value)} placeholder="Leave empty to use Go from PATH" className={inputClass} /></label>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        {TEXT_FIELDS.map(({ key, label, placeholder }) => (
          <label key={key} className="block text-[10px] text-text-3">{label}<input value={form.fields[key]} onChange={(event) => setField(key, event.target.value)} placeholder={placeholder} className={inputClass} /></label>
        ))}
        <label className="block text-[10px] text-text-3">CGO
          <select value={form.fields.CGO_ENABLED} onChange={(event) => setField('CGO_ENABLED', event.target.value)} className={inputClass}>
            <option value="">Default</option><option value="1">Enabled (CGO_ENABLED=1)</option><option value="0">Disabled (CGO_ENABLED=0)</option>
          </select>
        </label>
        <label className="block text-[10px] text-text-3">Build tags<input value={form.buildTags} onChange={(event) => setForm({ ...form, buildTags: event.target.value })} placeholder="integration, e2e" className={inputClass} /></label>
      </div>
      <label className="mt-2 block text-[10px] text-text-3">Other GOFLAGS<input value={form.goflags} onChange={(event) => setForm({ ...form, goflags: event.target.value })} placeholder="-mod=mod -trimpath" className={inputClass} /></label>
      <label className="mt-2 block text-[10px] text-text-3">Other variables<textarea value={form.other} onChange={(event) => setForm({ ...form, other: event.target.value })} placeholder={'GOTOOLCHAIN=local\nGOEXPERIMENT=…'} className="mt-1 h-16 w-full resize-none rounded border border-border-1 bg-surface-0 p-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" /></label>
      <div className="mt-2 flex items-center gap-2">
        <p className="text-[9px] text-text-4">Applies to build, run, test, gopls and tools. Values with credentials in URLs stay in memory only.</p>
        {scope === 'project' && settings?.project && <button type="button" disabled={busy} onClick={() => void useGlobal()} className="ml-auto h-7 rounded border border-border-1 px-3 text-[10px] text-text-2 hover:border-accent disabled:opacity-40">Use global default</button>}
        <button type="button" disabled={busy} onClick={() => void save()} className={`${scope === 'project' && settings?.project ? '' : 'ml-auto '}flex h-7 items-center gap-1 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40`}>{busy && <Loader2 size={11} className="animate-spin" />}{scope === 'project' ? 'Save for project' : 'Save as global default'}</button>
      </div>
    </section>
  )
}
