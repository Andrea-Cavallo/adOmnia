import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Database, Eye, EyeOff, MoreVertical, Plus, Search, Shield, Trash2, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DRIVER_META, DbDriverIcon, SELECTABLE_DRIVERS,
  type DbConnection, type DbDriver, type SelectableDbDriver,
} from './dbShared'
import { databaseCredentialState } from './dbSecrets'
import { isVaultRef } from '@/lib/vaultRefs'

interface ConnectionsSidebarProps {
  width: number
  connections: DbConnection[]
  active: DbConnection
  running: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  onUpdate: (patch: Partial<DbConnection>) => void
  onSetDriver: (driver: DbDriver) => void
  onTest: () => void
  onConnect: () => void
  onDisconnect: () => void
  statuses: Record<string, { state: string; latencyMs: number; error?: string }>
  onVault: (passphrase: string) => Promise<void>
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
  const { width, connections, active, running, onSelect, onAdd, onDelete, onUpdate, onSetDriver, onTest, onVault, onCreateLocalSQLite, onConnect, onDisconnect, statuses } = props
  const [passwordDraft, setPasswordDraft] = useState('')
  const [dsnDraft, setDsnDraft] = useState('')
  const [editingPassword, setEditingPassword] = useState(false)
  const [editingDsn, setEditingDsn] = useState(false)
  const secretSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSecretSave = (patch: Partial<DbConnection>) => {
    if (secretSaveTimer.current) clearTimeout(secretSaveTimer.current)
    secretSaveTimer.current = setTimeout(() => { secretSaveTimer.current = null; onUpdate(patch) }, 250)
  }
  useEffect(() => () => { if (secretSaveTimer.current) clearTimeout(secretSaveTimer.current) }, [active.id])
  useEffect(() => { setPasswordDraft(''); setDsnDraft(''); setEditingPassword(false); setEditingDsn(false) }, [active.id])
  const status = statuses[active.id]
  const [search, setSearch] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [vaultPassphrase, setVaultPassphrase] = useState('')
  const [menuId, setMenuId] = useState('')
  const credentialState = databaseCredentialState(active)

  const filtered = connections.filter((c) =>
    !search.trim() ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    DRIVER_META[c.driver]?.label.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <aside className="flex flex-none flex-col bg-surface-1" style={{ width }}>
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
                className={cn(
                  'group relative flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors focus-within:ring-2 focus-within:ring-accent',
                  isActive
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-transparent hover:border-border-2 hover:bg-surface-2'
                )}
              >
                <button type="button" aria-pressed={isActive} onClick={() => onSelect(conn.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none">
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-md border" style={{ borderColor: `${meta.accent}44`, background: `${meta.accent}14` }}>
                    <DbDriverIcon driver={conn.driver} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[12.5px] font-medium', isActive ? 'text-text-1' : 'text-text-2')}>{conn.name}</span>
                    <span className="block truncate text-[10.5px] text-text-4">{sub}</span>
                    <span className={cn('block text-[10px]', statuses[conn.id]?.state === 'connected' ? 'text-success' : statuses[conn.id]?.state === 'error' ? 'text-danger' : 'text-text-4')}>{statuses[conn.id]?.state ?? 'disconnected'}{statuses[conn.id]?.state === 'connected' ? ` · ${statuses[conn.id].latencyMs} ms` : ''}</span>
                  </span>
                </button>
                <button
                  aria-label={`Connection actions for ${conn.name}`}
                  aria-expanded={menuId === conn.id}
                  onClick={(e) => { e.stopPropagation(); setMenuId(menuId === conn.id ? '' : conn.id) }}
                  className={cn(
                    'grid h-6 w-6 flex-none place-items-center rounded text-text-4 transition-opacity hover:bg-surface-3 hover:text-text-1',
                    isActive || menuId === conn.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
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
        <div className="mb-4 grid grid-cols-3 gap-1">
          {SELECTABLE_DRIVERS.map((driver: SelectableDbDriver) => {
            const isActive = active.driver === driver
            return (
              <button
                key={driver}
                onClick={() => onSetDriver(driver)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border py-1.5 text-[10.5px] font-medium transition-colors',
                  isActive
                    ? 'border-accent bg-accent text-white shadow-none'
                    : 'border-border-2 bg-surface-2 text-text-3 hover:border-border-3 hover:text-text-1'
                )}
              >
                <DbDriverIcon driver={driver} size={16} mono={isActive} />
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
              <Field label={active.driver === 'redis' ? 'DB index' : 'Database'}>
                <input value={active.database} onChange={(e) => onUpdate({ database: e.target.value })} className={inputCls} placeholder={active.driver === 'redis' ? '0' : 'adomnia'} />
              </Field>
              {active.driver === 'redis' && (
                <label className="ml-[90px] flex items-center gap-2 text-[11px] text-text-2">
                  <input type="checkbox" checked={active.sslMode !== 'disable' && !!active.sslMode} onChange={(e) => onUpdate({ sslMode: e.target.checked ? 'require' : 'disable' })} className="accent-accent" />
                  TLS (verify server certificate)
                </label>
              )}
              {active.driver === 'mongodb' && (
                <>
                  <Field label="Collection">
                    <input value={active.collection ?? ''} onChange={(e) => onUpdate({ collection: e.target.value })} className={inputCls} placeholder="users" />
                  </Field>
                  <Field label="Options">
                    <input value={active.options ?? ''} onChange={(e) => onUpdate({ options: e.target.value })} className={cn(inputCls, 'font-mono text-[11px]')} placeholder="authSource=admin&tls=true" title="URI options, e.g. authSource, authMechanism, tls, replicaSet, directConnection" />
                  </Field>
                  <label className="ml-[90px] flex items-center gap-2 text-[11px] text-text-2">
                    <input type="checkbox" checked={!!active.srv} onChange={(e) => onUpdate({ srv: e.target.checked })} className="accent-accent" />
                    SRV record (mongodb+srv, e.g. Atlas)
                  </label>
                </>
              )}
              <Field label="User">
                <input value={active.user} onChange={(e) => onUpdate({ user: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    aria-label="Database password"
                    value={passwordDraft}
                    placeholder={isVaultRef(active.password) ? '•••••••• saved' : 'Password'}
                    onChange={(e) => { setPasswordDraft(e.target.value); setEditingPassword(true); if (e.target.value) scheduleSecretSave({ password: e.target.value }) }}
                    onBlur={() => { if (secretSaveTimer.current) clearTimeout(secretSaveTimer.current); if (editingPassword && passwordDraft) { onUpdate({ password: passwordDraft }); setPasswordDraft(''); setEditingPassword(false) } }}
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
              {isVaultRef(active.password) && <div className="ml-[90px] flex gap-3 text-[11px]"><button type="button" onClick={() => setEditingPassword(true)} className="text-accent">Change password</button><button type="button" onClick={() => onUpdate({ password: '' })} className="text-danger">Remove password</button></div>}
            </>
          )}
          <Field label="Raw DSN">
            <input
              aria-label="Database DSN"
              value={editingDsn ? dsnDraft : isVaultRef(active.dsn) ? '' : active.dsn}
              onChange={(e) => { setDsnDraft(e.target.value); setEditingDsn(true); if (e.target.value) scheduleSecretSave({ dsn: e.target.value }) }}
              onBlur={() => { if (secretSaveTimer.current) clearTimeout(secretSaveTimer.current); if (editingDsn && dsnDraft) { onUpdate({ dsn: dsnDraft }); setDsnDraft(''); setEditingDsn(false) } }}
              className={cn(inputCls, 'font-mono text-[11px] text-text-3')}
              placeholder={isVaultRef(active.dsn) ? 'Encrypted DSN saved' : active.driver === 'redis' ? 'redis://127.0.0.1:6379/0' : 'optional connection string'}
            />
          </Field>
          {isVaultRef(active.dsn) && <button type="button" onClick={() => onUpdate({ dsn: '' })} className="ml-[90px] text-[11px] text-danger">Remove DSN</button>}
          <Field label="Idle (min)"><input aria-label="Idle timeout minutes" type="number" min={1} max={120} value={active.idleTimeoutMinutes ?? 15} onChange={(e) => onUpdate({ idleTimeoutMinutes: Math.max(1, Math.min(120, Number(e.target.value))) })} className={inputCls} /></Field>
          <label className="flex gap-2 text-[11px] text-text-2"><input type="checkbox" checked={!!active.autoConnect} onChange={(e) => onUpdate({ autoConnect: e.target.checked })} />Auto-connect on selection</label>
        </div>

        {/* actions */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" disabled={running} onClick={status?.state === 'connected' ? onDisconnect : onConnect} className="col-span-2 h-8 rounded-md border border-accent bg-accent/10 text-[12px] text-accent disabled:opacity-40">{running ? 'Working…' : status?.state === 'connected' ? 'Disconnect' : 'Connect'}</button>
          <p className="col-span-2 text-[11px] text-text-3">{status?.state ?? 'disconnected'}{status?.state === 'connected' ? ` · ${status.latencyMs} ms` : ''}</p>
          <button
            onClick={onTest}
            disabled={running}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-border-2 bg-surface-2 text-[11.5px] font-medium text-text-2 transition-colors hover:border-accent/50 hover:text-text-1 disabled:opacity-40"
          >
            <Wand2 size={13} /> Test Connection
          </button>
          <button
            onClick={() => void onVault(vaultPassphrase).then(() => setVaultPassphrase('')).catch(() => undefined)}
            disabled={credentialState === 'none' || !vaultPassphrase}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-border-2 bg-surface-2 text-[11.5px] font-medium text-text-2 transition-colors hover:border-accent/50 hover:text-text-1 disabled:opacity-40"
          >
            <Shield size={13} /> Protect
          </button>
        </div>

        {credentialState !== 'none' && (
          <div className="mt-2 space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[10.5px] text-warning">
            <p>Credentials save automatically with local encryption. Optional extra passphrase protection requires unlocking the Vault after restart.</p>
            <input
              type="password"
              value={vaultPassphrase}
              onChange={(event) => setVaultPassphrase(event.target.value)}
              placeholder="Vault passphrase"
              className={inputCls}
            />
          </div>
        )}

        {/* runner note */}
        {active.driver === 'redis' && (
          <div className="mt-3 rounded-lg border border-border-2 bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-text-3">
            Run JSON commands: {`{"command":"GET","args":["key"]}`}. Browse keys in the explorer; writes require confirmation. Use rediss:// for TLS.
          </div>
        )}
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
        {credentialState === 'vault' && (
          <div className="mt-2 rounded-lg border border-success/25 bg-success/8 px-3 py-2 text-[10.5px] text-success">
            Credentials are encrypted at rest and resolved only while this connection is used.
          </div>
        )}
        {active.credentialWarning && <p className="mt-2 text-[11px] text-warning">{active.credentialWarning}</p>}
        {active.user && !active.password && !active.dsn && <p className="mt-2 text-[11px] text-warning">If this connection previously had a password, enter it once again. Older session-only credentials cannot be recovered.</p>}
        {active.driver === 'db2' && (
          <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[10.5px] text-warning">
            This Db2 preset is retained for compatibility, but Db2 is unavailable in this portable build. Select a supported driver.
          </div>
        )}
      </div>
    </aside>
  )
}
