import { useState, type ReactNode } from 'react'
import { CheckCircle2, Database, Eye, EyeOff, MoreVertical, Plus, Search, Shield, Trash2, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DRIVER_META, SELECTABLE_DRIVERS,
  type DbConnection, type DbDriver, type SelectableDbDriver,
} from './dbShared'

interface ConnectionsSidebarProps {
  connections: DbConnection[]
  active: DbConnection
  running: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  onUpdate: (patch: Partial<DbConnection>) => void
  onSetDriver: (driver: DbDriver) => void
  onTest: () => void
  onVault: () => void
  onCreateLocalSQLite: () => void
}

// ── labeled field (label on the left, input on the right) ───────────────────
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[78px_1fr] items-center gap-3">
      <span className="text-[11px] text-text-3">{label}</span>
      {children}
    </div>
  )
}

const inputCls = 'h-8 w-full rounded-md border border-border-2 bg-surface-2 px-2.5 text-[12px] text-text-1 outline-none transition-colors focus:border-accent/60 focus:bg-surface-3'

export function ConnectionsSidebar(props: ConnectionsSidebarProps) {
  const { connections, active, running, onSelect, onAdd, onDelete, onUpdate, onSetDriver, onTest, onVault, onCreateLocalSQLite } = props
  const [search, setSearch] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [menuId, setMenuId] = useState('')

  const filtered = connections.filter((c) =>
    !search.trim() ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    DRIVER_META[c.driver]?.label.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <aside className="flex w-[336px] flex-none flex-col border-r border-border-1 bg-surface-1">
      {/* header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-text-1">Connections</h2>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-md border border-border-2 bg-surface-2 px-2.5 py-1.5 text-[11.5px] font-medium text-text-2 transition-colors hover:border-accent/50 hover:text-text-1"
        >
          <Plus size={13} /> New
        </button>
      </div>

      {/* search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search connections"
            className="h-8 w-full rounded-md border border-border-2 bg-surface-2 pl-8 pr-2.5 text-[12px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
          />
        </div>
      </div>

      {/* connection list */}
      <div className="max-h-[230px] overflow-y-auto px-3">
        <div className="space-y-1">
          {filtered.map((conn) => {
            const isActive = conn.id === active.id
            const meta = DRIVER_META[conn.driver]
            const sub = conn.driver === 'sqlite'
              ? `${meta.short} · local`
              : `${meta.short} · ${conn.host || '—'}`
            return (
              <div
                key={conn.id}
                onClick={() => onSelect(conn.id)}
                className={cn(
                  'group relative flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors',
                  isActive
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-transparent hover:border-border-2 hover:bg-surface-2'
                )}
              >
                <div
                  className="grid h-8 w-8 flex-none place-items-center rounded-md border"
                  style={{ borderColor: `${meta.accent}44`, background: `${meta.accent}14` }}
                >
                  <Database size={15} style={{ color: meta.accent }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate text-[12.5px] font-medium', isActive ? 'text-text-1' : 'text-text-2')}>{conn.name}</div>
                  <div className="truncate text-[10.5px] text-text-4">{sub}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuId(menuId === conn.id ? '' : conn.id) }}
                  className={cn(
                    'grid h-6 w-6 flex-none place-items-center rounded text-text-4 transition-opacity hover:bg-surface-3 hover:text-text-1',
                    isActive || menuId === conn.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <MoreVertical size={13} />
                </button>
                {menuId === conn.id && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={(event) => { event.stopPropagation(); setMenuId('') }} />
                    <div
                      className="absolute right-2 top-full z-30 mt-1 w-36 overflow-hidden rounded-md border border-border-2 bg-surface-3 py-1 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => { onDelete(conn.id); setMenuId('') }}
                        disabled={connections.length <= 1}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-error hover:bg-error/10 disabled:opacity-40"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="mx-4 my-3 h-px bg-border-1" />

      {/* form area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {/* database type */}
        <div className="mb-1.5 text-[11px] font-medium text-text-2">Database Type</div>
        <div className="mb-4 grid grid-cols-4 gap-1">
          {SELECTABLE_DRIVERS.map((driver: SelectableDbDriver) => {
            const isActive = active.driver === driver
            return (
              <button
                key={driver}
                onClick={() => onSetDriver(driver)}
                className={cn(
                  'rounded-md border py-1.5 text-[10.5px] font-medium transition-colors',
                  isActive
                    ? 'border-accent bg-accent text-white shadow-[0_0_12px_rgba(139,61,255,0.35)]'
                    : 'border-border-2 bg-surface-2 text-text-3 hover:border-border-3 hover:text-text-1'
                )}
              >
                {DRIVER_META[driver].short}
              </button>
            )
          })}
        </div>

        {/* connection */}
        <div className="mb-2 text-[11px] font-medium text-text-2">Connection</div>
        <div className="space-y-2">
          <Field label="Name">
            <input value={active.name} onChange={(e) => onUpdate({ name: e.target.value })} className={inputCls} placeholder="Connection name" />
          </Field>
          {active.driver === 'sqlite' ? (
            <>
              <Field label="File path">
                <input value={active.sqlitePath} onChange={(e) => onUpdate({ sqlitePath: e.target.value })} className={cn(inputCls, 'font-mono text-[11px]')} placeholder="C:\data\app.db" />
              </Field>
              <button
                type="button"
                onClick={onCreateLocalSQLite}
                disabled={running}
                className="ml-[90px] flex h-8 items-center justify-center gap-1.5 rounded-md border border-accent/35 bg-accent/10 px-3 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/15 disabled:opacity-40"
              >
                <Database size={13} /> Create local database
              </button>
            </>
          ) : (
            <>
              <Field label="Host">
                <input value={active.host} onChange={(e) => onUpdate({ host: e.target.value })} className={inputCls} placeholder="127.0.0.1" />
              </Field>
              <Field label="Port">
                <input type="number" value={active.port} onChange={(e) => onUpdate({ port: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Database">
                <input value={active.database} onChange={(e) => onUpdate({ database: e.target.value })} className={inputCls} placeholder="adomnia" />
              </Field>
              {active.driver === 'mongodb' && (
                <Field label="Collection">
                  <input value={active.collection ?? ''} onChange={(e) => onUpdate({ collection: e.target.value })} className={inputCls} placeholder="users" />
                </Field>
              )}
              <Field label="User">
                <input value={active.user} onChange={(e) => onUpdate({ user: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={active.password}
                    onChange={(e) => onUpdate({ password: e.target.value, savedInVault: false })}
                    className={cn(inputCls, 'pr-8')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2"
                  >
                    {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </Field>
            </>
          )}
          <Field label="Raw DSN">
            <input
              value={active.dsn}
              onChange={(e) => onUpdate({ dsn: e.target.value })}
              className={cn(inputCls, 'font-mono text-[11px] text-text-3')}
              placeholder="optional connection string"
            />
          </Field>
        </div>

        {/* actions */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={onTest}
            disabled={running}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-border-2 bg-surface-2 text-[11.5px] font-medium text-text-2 transition-colors hover:border-accent/50 hover:text-text-1 disabled:opacity-40"
          >
            <Wand2 size={13} /> Test Connection
          </button>
          <button
            onClick={onVault}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-border-2 bg-surface-2 text-[11.5px] font-medium text-text-2 transition-colors hover:border-accent/50 hover:text-text-1"
          >
            <Shield size={13} /> Vault
          </button>
        </div>

        {/* runner note */}
        {active.driver === 'mongodb' && (
          <div className="mt-3 flex gap-2 rounded-lg border border-success/25 bg-success/8 px-3 py-2.5">
            <CheckCircle2 size={14} className="mt-px flex-none text-success" />
            <div className="min-w-0">
              <div className="text-[11.5px] font-medium text-success">MongoDB runner is enabled</div>
              <div className="mt-0.5 text-[10.5px] leading-relaxed text-text-3">
                JSON operations: find, aggregate, insertOne/Many, updateOne/Many, deleteOne/Many, count, listCollections
              </div>
            </div>
          </div>
        )}
        {active.savedInVault && (
          <div className="mt-2 rounded-lg border border-success/25 bg-success/8 px-3 py-2 text-[10.5px] text-success">
            Credential handoff sent to Vault. Remove plaintext here after encrypting.
          </div>
        )}
        {active.driver === 'db2' && (
          <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[10.5px] text-warning">
            This Db2 preset is retained for compatibility, but Db2 is unavailable in this portable build. Select a supported driver.
          </div>
        )}
      </div>
    </aside>
  )
}
