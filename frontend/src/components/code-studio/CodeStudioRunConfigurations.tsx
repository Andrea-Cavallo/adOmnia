import { useEffect, useState } from 'react'
import { Plus, Copy, Trash2, Pin, Share2, Play, ChevronUp, ChevronDown, Search, FolderOpen, Circle } from 'lucide-react'
import { CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import { RunConfigForm } from './RunConfigForm'
import { CodeStudioRunWizard } from './CodeStudioRunWizard'
import { confirm } from '@/lib/confirmDialog'
import { useCodeStudioStore } from '@/stores/codeStudio'
import type { GoIDERunConfiguration } from '@/lib/code-studio-api'
import { cleanRunConfiguration, emptyRunConfiguration } from '@/lib/code-studio/runFormTypes'
import { groupConfigurationsByUnit } from '@/lib/code-studio/runUnits'
import { templateFor } from '@/lib/code-studio/runFormSchema'
import './codeStudioRunConfigurations.css'

const EMPTY_CONFIGS: GoIDERunConfiguration[] = []
interface Props { open: boolean; sessionId: string; initialDraft?: GoIDERunConfiguration | null; onClose: () => void }
export function CodeStudioRunConfigurations({ open, sessionId, initialDraft, onClose }: Props) {
  const configs = useCodeStudioStore(state => state.runConfigsBySession[sessionId] ?? EMPTY_CONFIGS)
  const session = useCodeStudioStore(state => state.sessions.find(item => item.id === sessionId))
  const languages = useCodeStudioStore(state => state.capabilities?.languages)
  const [draft, setDraft] = useState(() => emptyRunConfiguration(sessionId))
  const [wizard, setWizard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [query, setQuery] = useState('')
  const [baseline, setBaseline] = useState('')
  const [reload, setReload] = useState(0)
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    setLoading(true); setReady(false); setQuery(''); setBaseline(''); setFeedback(null); useCodeStudioStore.setState({ error: null })
    const store = useCodeStudioStore.getState()
    void store.loadRunConfigurations(sessionId).then(() => {
      if (!live) return
      const state = useCodeStudioStore.getState()
      if (state.error) { setFeedback({ error: true, message: state.error }); setLoading(false); return }
      const saved = state.runConfigsBySession[sessionId] ?? []
      const selected = saved.find(config => config.id === state.activeConfigBySession[sessionId]) ?? saved[0]
      const next = initialDraft ?? selected ?? emptyRunConfiguration(sessionId)
      setDraft(next); setBaseline(JSON.stringify(initialDraft && !initialDraft.id ? emptyRunConfiguration(sessionId) : next))
      setWizard(!initialDraft && !selected); setLoading(false)
    }).catch(error => { if (live) { setLoading(false); setFeedback({ error: true, message: String(error) }) } })
    return () => { live = false }
  }, [open, sessionId, initialDraft, reload])
  if (!open) return null
  const patch = (change: Partial<GoIDERunConfiguration>) => { setDraft(current => ({ ...current, ...change })); setFeedback(null) }
  const dirty = !wizard && !!baseline && JSON.stringify(draft) !== baseline
  const discard = async () => !dirty || await confirm({ title: 'Discard unsaved changes?', message: 'Your changes to this run configuration have not been saved.', confirmLabel: 'Discard changes', variant: 'danger' })
  const close = async () => { if (!busy && await discard()) onClose() }
  const select = (config: GoIDERunConfiguration) => { setDraft({ ...config }); setBaseline(JSON.stringify(config)); setReady(false); setWizard(false); setFeedback(null) }
  const choose = (config: GoIDERunConfiguration) => { select(config); setBaseline(JSON.stringify(emptyRunConfiguration(sessionId))) }
  const filtered = configs.filter(config => `${config.name} ${templateFor(config).group} ${templateFor(config).label} ${config.workingDirectory}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const groups = session ? groupConfigurationsByUnit(filtered, session.project, Object.fromEntries((languages ?? []).map(info => [info.id, info.name]))) : [{ label: '', items: filtered }]
  const template = templateFor(draft)
  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setFeedback(null); useCodeStudioStore.setState({ error: null })
    try {
      await action()
      const error = useCodeStudioStore.getState().error
      setFeedback({ error: !!error, message: error || success })
    } catch (error) { setFeedback({ error: true, message: error instanceof Error ? error.message : String(error) }) }
    finally { setBusy(false) }
  }
  const save = async (candidate = draft) => {
    await act(async () => {
      const saved = await useCodeStudioStore.getState().saveRunConfiguration(cleanRunConfiguration(candidate))
      if (saved) { setDraft(saved); setBaseline(JSON.stringify(saved)); setWizard(false) }
    }, 'Configuration saved.')
  }
  const duplicate = () => act(async () => {
    await useCodeStudioStore.getState().duplicateRunConfiguration(draft.id)
    const state = useCodeStudioStore.getState()
    const copy = state.runConfigsBySession[sessionId]?.find(config => config.id === state.activeConfigBySession[sessionId])
    if (copy) select(copy)
  }, 'Configuration duplicated.')
  const remove = async () => {
    if (!await confirm({ title: `Delete "${draft.name}"?`, message: 'Remove this configuration from the project.', confirmLabel: 'Delete', variant: 'danger' })) return
    await act(async () => {
      await useCodeStudioStore.getState().deleteRunConfiguration(draft.id)
      const state = useCodeStudioStore.getState()
      if (state.error) return
      const next = state.runConfigsBySession[sessionId]?.[0]
      if (next) select(next)
      else { setDraft(emptyRunConfiguration(sessionId)); setWizard(true) }
    }, 'Configuration deleted.')
  }
  const move = (delta: number) => act(async () => {
    const ids = configs.map(config => config.id)
    const index = ids.indexOf(draft.id)
    if (index + delta < 0 || index + delta >= ids.length) return
    ids.splice(index + delta, 0, ...ids.splice(index, 1))
    await useCodeStudioStore.getState().reorderRunConfigurations(ids)
  }, 'Order updated.')
  return <CodeStudioModal open={open} onClose={() => void close()} persistent size="full" tall divided flush icon={Play} className="run-config-modal" title="Run configurations" subtitle={session?.project.rootPath.replace(/\\/g, '/').split('/').pop() || 'Project launch settings'} footer={<>
    <span role={feedback?.error ? 'alert' : 'status'} aria-live="polite" className={`mr-auto min-w-0 text-[12px] ${feedback?.error ? 'text-danger' : 'text-success'}`}>{feedback?.message}</span>
    {dirty && !feedback && <span className="run-unsaved"><Circle size={7} fill="currentColor" />Unsaved changes</span>}
    <CodeStudioButton variant="ghost" disabled={busy} onClick={() => void close()}>Close</CodeStudioButton>
    {!wizard && <CodeStudioButton variant="primary" loading={busy} disabled={loading || !ready || !draft.name.trim()} onClick={() => {
      const form = document.getElementById('code-studio-run-config-form') as HTMLFormElement | null
      form?.requestSubmit()
    }}>{draft.id ? 'Save configuration' : 'Create configuration'}</CodeStudioButton>}
  </>}>
    <div className="run-config-layout">
      <aside className="run-config-sidebar" aria-label="Saved run configurations">
        <div className="run-sidebar-heading"><span className="run-eyebrow">SAVED <span>{configs.length}</span></span><button type="button" className="gs-btn gs-btn-secondary gs-btn-sm" title="New configuration" aria-label="New configuration" disabled={busy || loading} onClick={async () => { if (await discard()) { setWizard(true); setFeedback(null) } }}><Plus size={14} /></button></div>
        <label className="run-search run-sidebar-search"><Search size={13} /><input aria-label="Search saved configurations" placeholder="Find a configuration…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="run-saved-list" aria-busy={loading}>
          {!loading && configs.length === 0 && <div className="run-empty"><FolderOpen size={24} /><p>No configurations yet</p><span>Create one from your project to get started.</span></div>}
          {!loading && configs.length > 0 && filtered.length === 0 && <p className="gs-list-empty">No matching configurations.</p>}
          {groups.map(group => <div key={group.label || 'all'}>
            {group.label && <h3 className="run-unit-heading">{group.label}</h3>}
            {group.items.map(config => <button key={config.id} type="button" disabled={busy || loading} aria-current={!wizard && config.id === draft.id ? 'true' : undefined} onClick={async () => { if (config.id === draft.id && !wizard) return; if (await discard()) select(config) }} className="run-saved-item">
              <Play size={13} className="shrink-0" /><span className="min-w-0 flex-1"><strong>{config.name}</strong><small>{templateFor(config).group} · {templateFor(config).label}</small></span>{config.pinned && <Pin size={11} aria-label="Pinned" />}{config.shared && <Share2 size={11} aria-label="Shared" />}
            </button>)}
          </div>)}
        </div>
        <div className="run-sidebar-footnote">Configurations stay with this project.<br />Enable Share to version them in Git.</div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {loading ? <p role="status" className="gs-hint p-5">Loading configurations…</p>
        : !baseline ? <div className="run-empty"><p>Configurations could not be loaded.</p><CodeStudioButton onClick={() => setReload(value => value + 1)}>Retry</CodeStudioButton></div>
        : wizard ? <CodeStudioRunWizard sessionId={sessionId} busy={busy} onChoose={choose} />
        : <>
          <div className="run-editor-toolbar">
            <div className="mr-auto min-w-0"><span className="run-eyebrow">{template.group} / {draft.id ? 'CONFIGURATION' : 'NEW'}</span><h2 className="truncate">{draft.name || 'Untitled configuration'}</h2></div>
            <CodeStudioButton variant="ghost" disabled={!draft.id || busy} onClick={async () => { if (await discard()) void duplicate() }}><Copy size={13} />Duplicate</CodeStudioButton>
            <CodeStudioButton variant="ghost" disabled={!draft.id || busy || configs[0]?.id === draft.id} title="Move up" onClick={() => void move(-1)}><ChevronUp size={13} /></CodeStudioButton>
            <CodeStudioButton variant="ghost" disabled={!draft.id || busy || configs[configs.length - 1]?.id === draft.id} title="Move down" onClick={() => void move(1)}><ChevronDown size={13} /></CodeStudioButton>
            <CodeStudioButton variant="ghost" disabled={!draft.id || busy} onClick={() => void remove()}><Trash2 size={13} />Delete</CodeStudioButton>
          </div>
          <form id="code-studio-run-config-form" className={`run-config-form flex min-h-0 flex-1 flex-col ${busy ? 'pointer-events-none opacity-60' : ''}`} onSubmit={event => { event.preventDefault(); if (ready && !busy) void save() }}>
            <fieldset disabled={busy} className="flex min-h-0 min-w-0 flex-1 flex-col"><RunConfigForm key={draft.id || 'new'} draft={draft} configs={configs} patch={patch} onReady={setReady} /></fieldset>
          </form>
        </>}
      </div>
    </div>
  </CodeStudioModal>
}
