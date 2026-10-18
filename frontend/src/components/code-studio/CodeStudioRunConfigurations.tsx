import { useEffect, useState } from 'react'
import { Plus, Copy, Trash2, Pin, Share2, Play, ChevronUp, ChevronDown } from 'lucide-react'
import { CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import { RunConfigForm } from './RunConfigForm'
import { CodeStudioRunWizard } from './CodeStudioRunWizard'
import { confirm } from '@/lib/confirmDialog'
import { useCodeStudioStore } from '@/stores/codeStudio'
import type { GoIDERunConfiguration } from '@/lib/code-studio-api'
import { cleanRunConfiguration, emptyRunConfiguration } from '@/lib/code-studio/runFormTypes'
import { groupConfigurationsByUnit } from '@/lib/code-studio/runUnits'

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
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    setLoading(true); setFeedback(null); useCodeStudioStore.setState({ error: null })
    const store = useCodeStudioStore.getState()
    void store.loadRunConfigurations(sessionId).then(() => {
      if (!live) return
      const state = useCodeStudioStore.getState()
      if (state.error) setFeedback({ error: true, message: state.error })
      const saved = state.runConfigsBySession[sessionId] ?? []
      const selected = saved.find(config => config.id === state.activeConfigBySession[sessionId]) ?? saved[0]
      setDraft(initialDraft ?? selected ?? emptyRunConfiguration(sessionId))
      setWizard(!initialDraft && !selected); setLoading(false)
    })
    return () => { live = false }
  }, [open, sessionId, initialDraft])
  if (!open) return null
  const patch = (change: Partial<GoIDERunConfiguration>) => { setDraft(current => ({ ...current, ...change })); setFeedback(null) }
  const select = (config: GoIDERunConfiguration) => { setDraft({ ...config }); setWizard(false); setFeedback(null) }
  const groups = session ? groupConfigurationsByUnit(configs, session.project, Object.fromEntries((languages ?? []).map(info => [info.id, info.name]))) : [{ label: '', items: configs }]
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
      if (saved) { setDraft(saved); setWizard(false) }
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
  return <CodeStudioModal open={open} onClose={onClose} size="xl" tall divided flush icon={Play} title="Run configurations" subtitle="Choose a saved configuration, or create one from your project." footer={<>
    <span role={feedback?.error ? 'alert' : 'status'} aria-live="polite" className={`mr-auto min-w-0 text-[12px] ${feedback?.error ? 'text-danger' : 'text-success'}`}>{feedback?.message}</span>
    <CodeStudioButton variant="ghost" onClick={onClose}>Close</CodeStudioButton>
    {!wizard && <CodeStudioButton variant="primary" loading={busy} disabled={loading || !ready || !draft.name.trim()} onClick={() => {
      const form = document.getElementById('code-studio-run-config-form') as HTMLFormElement | null
      form?.requestSubmit()
    }}>{draft.id ? 'Save configuration' : 'Create configuration'}</CodeStudioButton>}
  </>}>
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border-1 bg-surface-0/40">
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {configs.length === 0 && <p className="gs-list-empty">No saved configurations.</p>}
          {groups.map(group => <div key={group.label || 'all'}>
            {group.label && <h3 className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-text-4">{group.label}</h3>}
            {group.items.map(config => <button key={config.id} type="button" disabled={busy} aria-current={!wizard && config.id === draft.id ? 'true' : undefined} onClick={() => select(config)} className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] hover:bg-surface-2 focus-visible:outline focus-visible:outline-accent ${!wizard && config.id === draft.id ? 'bg-accent/10 text-text-1' : 'text-text-3'}`}>
              {config.pinned && <Pin size={12} />}<span className="min-w-0 flex-1 truncate">{config.name}</span>{config.shared && <Share2 size={12} />}
            </button>)}
          </div>)}
        </div>
        <button type="button" disabled={busy} onClick={() => { setWizard(true); setFeedback(null) }} className="gs-btn gs-btn-ghost m-2"><Plus size={14} />New configuration</button>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {loading ? <p role="status" className="gs-hint p-5">Loading configurations…</p>
        : wizard ? <CodeStudioRunWizard sessionId={sessionId} busy={busy} onChoose={candidate => { setDraft(candidate); setWizard(false); setFeedback(null) }} onCreate={candidate => save(candidate)} />
        : <>
          <div className="flex items-center gap-1 border-b border-border-1 px-4 py-2">
            <span className="gs-label mr-auto">Edit configuration</span>
            <CodeStudioButton variant="ghost" disabled={!draft.id || busy} onClick={() => void duplicate()}><Copy size={13} />Duplicate</CodeStudioButton>
            <CodeStudioButton variant="ghost" disabled={!draft.id || busy || configs[0]?.id === draft.id} title="Move up" onClick={() => void move(-1)}><ChevronUp size={13} /></CodeStudioButton>
            <CodeStudioButton variant="ghost" disabled={!draft.id || busy || configs[configs.length - 1]?.id === draft.id} title="Move down" onClick={() => void move(1)}><ChevronDown size={13} /></CodeStudioButton>
            <CodeStudioButton variant="ghost" disabled={!draft.id || busy} onClick={() => void remove()}><Trash2 size={13} />Delete</CodeStudioButton>
          </div>
          <form id="code-studio-run-config-form" className={`flex min-h-0 flex-1 flex-col ${busy ? 'pointer-events-none opacity-60' : ''}`} onSubmit={event => { event.preventDefault(); if (ready && !busy) void save() }}>
            <fieldset disabled={busy} className="flex min-h-0 flex-1 flex-col"><RunConfigForm key={draft.id || 'new'} draft={draft} configs={configs} patch={patch} onReady={setReady} /></fieldset>
          </form>
        </>}
      </div>
    </div>
  </CodeStudioModal>
}
