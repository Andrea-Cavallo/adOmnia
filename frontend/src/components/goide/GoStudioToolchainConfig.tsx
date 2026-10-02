import { useEffect, useState } from 'react'
import { Globe, FolderGit2} from 'lucide-react'
import { GoStudioButton, GoStudioField } from './GoStudioModal'
import { configureGoIDEGlobalToolchain, getGoIDEToolchainSettings, resetGoIDEToolchainToGlobal, type GoIDEToolchainSettings } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { modulePatternProblem, networkModeOf, suggestedPrivatePattern, toolchainEnvFromForm, toolchainFormFromEnv, withNetworkMode, type GoStudioNetworkMode, type ToolchainField, type ToolchainForm } from './goStudioToolchainEnv'

type Scope = 'project' | 'global'

const inputClass = 'gs-input gs-mono'

const TEXT_FIELDS: { key: ToolchainField; label: string; placeholder: string; hint?: string }[] = [
  { key: 'GOPROXY', label: 'GOPROXY', placeholder: 'https://proxy.golang.org,direct' },
  { key: 'GOPRIVATE', label: 'GOPRIVATE', placeholder: 'git.example.com/*', hint: 'Comma-separated module path prefixes fetched directly from their Git host, skipping the proxy and the checksum database. Credentials go in .netrc or a Git credential helper.' },
  { key: 'GONOPROXY', label: 'GONOPROXY', placeholder: 'defaults to GOPRIVATE' },
  { key: 'GONOSUMDB', label: 'GONOSUMDB', placeholder: 'defaults to GOPRIVATE' },
  { key: 'GOOS', label: 'GOOS', placeholder: 'host OS (linux, windows, darwin…)' },
  { key: 'GOARCH', label: 'GOARCH', placeholder: 'host arch (amd64, arm64…)' },
]

const NETWORK_MODES: { value: GoStudioNetworkMode; label: string; hint: string }[] = [
  { value: 'online', label: 'Online', hint: 'Modules and toolchains download through GOPROXY and are verified against the checksum database.' },
  { value: 'offline', label: 'Offline', hint: 'GOPROXY=off and GOTOOLCHAIN=local: builds use only the module cache and vendor/, nothing is downloaded.' },
  { value: 'airgapped', label: 'Air-gapped', hint: 'Offline plus GOSUMDB=off: no request ever leaves the machine. Point GOPROXY at an internal registry instead if you have one.' },
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
  const modules = useGoIDEStore((state) => state.sessions.find((item) => item.id === sessionId)?.project.modules)
  const suggestion = (modules ?? []).map((module) => suggestedPrivatePattern(module.modulePath ?? '')).find((pattern): pattern is string => !!pattern) ?? null
  const problems = TEXT_FIELDS.map(({ key }) => modulePatternProblem(key, form.fields[key])).filter((problem): problem is string => !!problem)

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
    <button type="button" aria-pressed={scope === value} onClick={() => switchScope(value)} className="gs-segment"><Icon size={13} />{label}</button>
  )

  return (
    <section className="flex flex-col gap-3 border-t border-border-1 pt-4">
      <div className="flex items-center gap-3">
        <h3 className="gs-section-title">Configuration</h3>
        <div role="group" aria-label="Configuration scope" className="gs-segmented">
          {scopeButton('project', 'This project', FolderGit2)}
          {scopeButton('global', 'Global default', Globe)}
        </div>
        <span className="ml-auto text-[11.5px] text-text-4">{settings?.project ? 'Project overrides the global default' : 'Project follows the global default'}</span>
      </div>
      <GoStudioField label="Network" hint={NETWORK_MODES.find((mode) => mode.value === networkModeOf(form))?.hint}>
        <div role="radiogroup" aria-label="Network mode" className="gs-segmented self-start">
          {NETWORK_MODES.map((mode) => (
            <button key={mode.value} type="button" role="radio" aria-checked={networkModeOf(form) === mode.value} aria-pressed={networkModeOf(form) === mode.value} onClick={(event) => { event.preventDefault(); setForm((current) => withNetworkMode(current, mode.value)) }} className="gs-segment">{mode.label}</button>
          ))}
        </div>
      </GoStudioField>
      <GoStudioField label="Go binary"><input value={goBinary} onChange={(event) => setGoBinary(event.target.value)} placeholder="Leave empty to use Go from PATH" className={inputClass} /></GoStudioField>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        {TEXT_FIELDS.map(({ key, label, placeholder, hint }) => {
          const problem = modulePatternProblem(key, form.fields[key])
          return (
            <GoStudioField key={key} label={label} hint={problem ? <span className="text-danger">{problem}</span> : hint}>
              <input value={form.fields[key]} onChange={(event) => setField(key, event.target.value)} placeholder={placeholder} aria-invalid={!!problem} className={inputClass} />
              {key === 'GOPRIVATE' && !form.fields.GOPRIVATE.trim() && suggestion && (
                <button type="button" onClick={(event) => { event.preventDefault(); setField('GOPRIVATE', suggestion) }} className="self-start text-[11px] text-accent hover:underline">Use {suggestion} (from this project's module path)</button>
              )}
            </GoStudioField>
          )
        })}
        <GoStudioField label="CGO">
          <select value={form.fields.CGO_ENABLED} onChange={(event) => setField('CGO_ENABLED', event.target.value)} className="gs-input">
            <option value="">Default</option><option value="1">Enabled (CGO_ENABLED=1)</option><option value="0">Disabled (CGO_ENABLED=0)</option>
          </select>
        </GoStudioField>
        <GoStudioField label="Build tags"><input value={form.buildTags} onChange={(event) => setForm({ ...form, buildTags: event.target.value })} placeholder="integration, e2e" className={inputClass} /></GoStudioField>
      </div>
      <GoStudioField label="Other GOFLAGS"><input value={form.goflags} onChange={(event) => setForm({ ...form, goflags: event.target.value })} placeholder="-mod=mod -trimpath" className={inputClass} /></GoStudioField>
      <GoStudioField label="Other variables" hint="Applies to build, run, test, gopls and tools. Values with credentials in URLs stay in memory only.">
        <textarea value={form.other} onChange={(event) => setForm({ ...form, other: event.target.value })} placeholder={'GOTOOLCHAIN=local\nGOEXPERIMENT=…'} className="gs-input gs-mono" />
      </GoStudioField>
      <div className="flex items-center justify-end gap-2">
        {scope === 'project' && settings?.project && <GoStudioButton variant="ghost" disabled={busy} onClick={() => void useGlobal()}>Use global default</GoStudioButton>}
        <GoStudioButton variant="primary" loading={busy} disabled={problems.length > 0} title={problems[0]} onClick={() => void save()}>{scope === 'project' ? 'Save for project' : 'Save as global default'}</GoStudioButton>
      </div>
    </section>
  )
}
