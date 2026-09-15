import { Database, Plus, Trash2, X } from 'lucide-react'
import { MAX_STRESS_VUS, type FlowStressConfig, type StressStage } from '@/lib/flowStress'
import type { StressDataset } from '@/lib/flowStressDataset'

const inputClass = 'h-7 min-w-0 rounded-md border border-border-2 bg-surface-0 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-accent disabled:opacity-50'

interface Props {
  config: FlowStressConfig
  running: boolean
  dataset: StressDataset | null
  onPatch: (next: Partial<FlowStressConfig>) => void
  onChooseDataset: () => void
  onClearDataset: () => void
}

export function FlowStressAdvancedConfig({ config, running, dataset, onPatch, onChooseDataset, onClearDataset }: Props) {
  const updateStage = (index: number, patch: Partial<StressStage>) => onPatch({ stages: (config.stages ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) })
  const addStage = () => onPatch({ stages: [...(config.stages ?? []), { id: crypto.randomUUID(), label: 'Stage', durationS: 30, targetVus: Math.min(config.vus, 20), rampS: 5, measure: true }] })
  const removeStage = (index: number) => onPatch({ stages: (config.stages ?? []).filter((_, itemIndex) => itemIndex !== index) })

  return (
    <div className="space-y-2.5 border-t border-border-1 pt-2.5">
      {config.mode === 'stages' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Workload stages</span><button type="button" disabled={running || (config.stages?.length ?? 0) >= 8} onClick={addStage} className="inline-flex items-center gap-1 text-[10px] text-accent disabled:opacity-40"><Plus size={10} /> Add</button></div>
          {(config.stages ?? []).map((item, index) => (
            <div key={item.id} className="grid grid-cols-[minmax(58px,1fr)_44px_44px_44px_28px_22px] items-center gap-1" title="Name · users · duration · ramp · include in measurements">
              <input aria-label={`Stage ${index + 1} name`} value={item.label} disabled={running} onChange={(event) => updateStage(index, { label: event.target.value })} className={inputClass} />
              <input aria-label={`${item.label} users`} type="number" min={0} max={MAX_STRESS_VUS} value={item.targetVus} disabled={running} onChange={(event) => updateStage(index, { targetVus: Number(event.target.value) })} className={inputClass} />
              <input aria-label={`${item.label} duration seconds`} type="number" min={1} max={3600} value={item.durationS} disabled={running} onChange={(event) => updateStage(index, { durationS: Number(event.target.value) })} className={inputClass} />
              <input aria-label={`${item.label} ramp seconds`} type="number" min={0} max={item.durationS} value={item.rampS} disabled={running} onChange={(event) => updateStage(index, { rampS: Number(event.target.value) })} className={inputClass} />
              <label className="grid place-items-center" title={item.measure ? 'Included in SLO measurements' : 'Warm-up/cooldown: load only'}><input aria-label={`${item.label} measured`} type="checkbox" checked={item.measure} disabled={running} onChange={(event) => updateStage(index, { measure: event.target.checked })} /></label>
              <button type="button" aria-label={`Remove ${item.label}`} disabled={running || (config.stages?.length ?? 0) <= 1} onClick={() => removeStage(index)} className="grid h-6 place-items-center text-text-4 hover:text-error disabled:opacity-30"><Trash2 size={10} /></button>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_44px_44px_44px_28px_22px] gap-1 px-0.5 text-center text-[8px] uppercase text-text-4"><span className="text-left">Phase</span><span>VU</span><span>Sec</span><span>Ramp</span><span>SLO</span><span /></div>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-4">Per-iteration data</span>{dataset && <button type="button" onClick={onClearDataset} disabled={running} aria-label="Clear dataset" className="text-text-4 hover:text-error"><X size={11} /></button>}</div>
        <div className="grid grid-cols-[1fr_92px] gap-1.5">
          <button type="button" disabled={running} onClick={onChooseDataset} className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-border-2 bg-surface-0 px-2 text-left text-[10px] text-text-2 hover:border-accent/50 disabled:opacity-50"><Database size={11} className="shrink-0" /><span className="truncate">{dataset ? `${dataset.name} · ${dataset.rows.length} rows` : 'Load CSV dataset'}</span></button>
          <select aria-label="Dataset allocation" disabled={running || !dataset} value={config.datasetMode ?? 'shared'} onChange={(event) => onPatch({ datasetMode: event.target.value as FlowStressConfig['datasetMode'] })} className={inputClass}>
            <option value="shared">Sequential</option><option value="per-vu">Per VU</option><option value="random">Random</option>
          </select>
        </div>
        <p className="mt-1 text-[9px] leading-3 text-text-4">CSV headers become variables. Built-ins: {'{{__vu}}'}, {'{{__iteration}}'}, {'{{__timestamp}}'}, {'{{__uuid}}'}.</p>
      </div>
    </div>
  )
}
