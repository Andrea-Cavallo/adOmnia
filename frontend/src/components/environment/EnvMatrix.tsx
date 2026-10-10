import { useState } from 'react'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { useEnvironmentsStore } from '@/stores/environments'
import { addMatrixKey, deleteMatrixKey, matrixRows, renameMatrixKey, setMatrixSecret, setMatrixValue } from '@/lib/envMatrix'
import { useUiTranslation } from '@/lib/uiI18n'
import { cn } from '@/lib/utils'

/** All environments side by side: one row per variable, one column per stage. */
export function EnvMatrix() {
  const tr = useUiTranslation()
  const environments = useEnvironmentsStore((s) => s.environments)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const setActiveEnv = useEnvironmentsStore((s) => s.setActiveEnv)
  const setEnvironments = useEnvironmentsStore((s) => s.setEnvironments)
  const [newKey, setNewKey] = useState('')
  const rows = matrixRows(environments)
  const columns = `minmax(150px,1fr) repeat(${environments.length}, minmax(150px,1fr)) 48px`

  if (environments.length === 0) {
    return <p className="flex flex-1 items-center justify-center text-xs text-text-4">{tr('No environments yet.')}</p>
  }

  const addKey = () => {
    const key = newKey.trim()
    if (!key) return
    setEnvironments(addMatrixKey(environments, key))
    setNewKey('')
  }

  return <div className="flex-1 overflow-auto p-3">
    <div className="grid min-w-max gap-1" style={{ gridTemplateColumns: columns }}>
      <span className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-4">{tr('Variable')}</span>
      {environments.map((env) => <button key={env.id} type="button" onClick={() => setActiveEnv(env.id)} aria-pressed={env.id === activeEnvId}
        title={tr('Set as active environment')}
        className={cn('truncate rounded px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors',
          env.id === activeEnvId ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-2 hover:text-text-1')}>
        {env.id === activeEnvId && '● '}{env.name}
      </button>)}
      <span />
      {rows.map((row) => <div key={row.key} className="group contents">
        <input defaultValue={row.key} aria-label={tr('Variable')}
          onBlur={(event) => { const next = event.target.value.trim(); if (next && next !== row.key) setEnvironments(renameMatrixKey(environments, row.key, next)) }}
          className="h-7 rounded border border-border-2 bg-surface-2 px-2 font-mono text-xs text-text-1 outline-none focus:border-accent" />
        {environments.map((env) => {
          const value = row.values[env.id]
          return <input key={env.id} value={value ?? ''} type={row.secret ? 'password' : 'text'}
            aria-label={`${row.key} · ${env.name}`} placeholder={value === undefined ? '—' : ''}
            onChange={(event) => setEnvironments(setMatrixValue(environments, row.key, env.id, event.target.value))}
            className={cn('h-7 rounded border bg-surface-2 px-2 font-mono text-xs text-text-1 outline-none placeholder:text-text-4 focus:border-accent',
              value === undefined ? 'border-dashed border-border-2' : 'border-border-2')} />
        })}
        <span className="flex items-center gap-0.5">
          <button type="button" onClick={() => setEnvironments(setMatrixSecret(environments, row.key, !row.secret))}
            title={row.secret ? tr('Show value') : tr('Mask as secret')} className="grid h-6 w-6 place-items-center text-text-4 hover:text-text-1">
            {row.secret ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
          <button type="button" onClick={() => setEnvironments(deleteMatrixKey(environments, row.key))}
            aria-label={tr('Delete')} className="grid h-6 w-6 place-items-center text-text-4 hover:text-error">
            <Trash2 size={11} />
          </button>
        </span>
      </div>)}
    </div>
    <form className="mt-2 flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); addKey() }}>
      <input value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="NEW_VARIABLE" aria-label={tr('Add Variable')}
        className="h-7 w-48 rounded border border-border-2 bg-surface-2 px-2 font-mono text-xs text-text-1 outline-none placeholder:text-text-4 focus:border-accent" />
      <button type="submit" disabled={!newKey.trim()} className="flex items-center gap-1 text-xs text-accent disabled:opacity-40"><Plus size={11} />{tr('Add Variable')}</button>
    </form>
  </div>
}
