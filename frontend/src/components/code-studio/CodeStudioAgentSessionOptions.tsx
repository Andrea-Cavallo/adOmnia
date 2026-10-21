import type { AgentSessionControls } from '@/lib/milk-api'

interface Props {
  controls: AgentSessionControls | null
  disabled: boolean
  onChange: (id: string, value: unknown) => Promise<void>
}

/** Only session values actually returned by the agent are offered. Permission modes stay in settings. */
export function CodeStudioAgentSessionOptions({ controls, disabled, onChange }: Props) {
  return <>{(controls?.controls ?? []).filter(control => ['model', 'thought_level'].includes(control.category ?? '') || ['routing', 'think'].includes(control.id)).map(control => control.type === 'boolean'
    ? <label key={control.id} className="flex items-center gap-1 text-[10px] text-text-3"><input type="checkbox" checked={control.currentValue === true} disabled={disabled} onChange={event => void onChange(control.id, event.target.checked)} />{control.name}</label>
    : <label key={control.id} className="min-w-0 max-w-40" title={control.id === '_milk_agent' ? 'Changes the configured primary agent for future milk sessions and starts a new chat for this project.' : control.name}><span className="sr-only">{control.name}</span><select aria-label={control.name} value={String(control.currentValue ?? '')} disabled={disabled} onChange={event => void onChange(control.id, event.target.value)} className="max-w-full rounded border border-border-1 bg-surface-2 px-1 py-1 text-[11px] text-text-2">
      {(control.options ?? []).flatMap(option => option.options?.length ? [<optgroup key={option.name} label={option.name}>{option.options.map(item => <option key={item.value} value={item.value}>{item.name || item.value}</option>)}</optgroup>] : [<option key={option.value} value={option.value}>{option.name || option.value}</option>])}
    </select></label>)}</>
}
