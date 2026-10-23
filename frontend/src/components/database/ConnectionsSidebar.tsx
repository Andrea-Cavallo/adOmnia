import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, Database, Eye, EyeOff, MoreVertical, Plus, Search, Shield, Trash2, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import './connectionsSidebar.css'
import {
  DRIVER_META, DbDriverIcon, SELECTABLE_DRIVERS,
  type DbConnection, type DbDriver, type SelectableDbDriver,
} from './dbShared'
import { databaseCredentialState } from './dbSecrets'
import { isVaultRef } from '@/lib/vaultRefs'

interface ConnectionsSidebarProps {
  width: number
  collapsed: boolean
  onToggleCollapsed: () => void
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
    <div className="dbc-field">
      <span>{label}</span>
      {children}
    </div>
  )
}

const inputCls = 'dbc-input'

export function ConnectionsSidebar(props: ConnectionsSidebarProps) {
  const { width, collapsed, onToggleCollapsed, connections, active, running, onSelect, onAdd, onDelete, onUpdate, onSetDriver, onTest, onVault, onCreateLocalSQLite, onConnect, onDisconnect, statuses } = props
  const [passwordDraft, setPasswordDraft] = useState('')
  const [dsnDraft, setDsnDraft] = useState('')
  const [editingPassword, setEditingPassword] = useState(false)
  const [editingDsn, setEditingDsn] = useState(false)
  const secretSaveTimer = useRef<{ connectionId: string; handle: ReturnType<typeof setTimeout> } | null>(null)
  const cancelSecretSave = () => { if (secretSaveTimer.current) clearTimeout(secretSaveTimer.current.handle); secretSaveTimer.current = null }
  const scheduleSecretSave = (patch: Partial<DbConnection>) => {
    cancelSecretSave()
    secretSaveTimer.current = { connectionId: active.id, handle: setTimeout(() => { secretSaveTimer.current = null; onUpdate(patch) }, 250) }
  }
  // Switching connection drops a pending (debounced) secret save of the previous one.
  useEffect(() => {
    const connectionId = active.id
    return () => { if (secretSaveTimer.current?.connectionId === connectionId) { clearTimeout(secretSaveTimer.current.handle); secretSaveTimer.current = null } }
  }, [active.id])
  const [draftsFor, setDraftsFor] = useState(active.id)
  if (draftsFor !== active.id) {
    setDraftsFor(active.id)
    setPasswordDraft(''); setDsnDraft(''); setEditingPassword(false); setEditingDsn(false)
  }
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

  const collapseButton = (
    <button type="button" className="dbc-icon-btn" onClick={onToggleCollapsed} aria-label={collapsed ? 'Show connections' : 'Hide connections'} title={collapsed ? 'Show connections' : 'Hide connections'}>
      {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
    </button>
  )

  if (collapsed) {
    return (
      <aside className="dbc" data-collapsed="true" aria-label="Connections (collapsed)">
        <div className="pt-3">{collapseButton}</div>
        <div className="dbc-rail">
          <span className="dbc-dot" data-state={status?.state ?? 'disconnected'} title={status?.state ?? 'disconnected'} />
          <span className="dbc-rail-name" title={active.name}>{active.name}</span>
        </div>
      </aside>
    )
  }

  return (
    <aside className="dbc" style={{ width }}>
      <div className="dbc-head">
        <h2 className="dbc-title">Connections</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onAdd} className="dbc-btn" style={{ height: 26 }}><Plus size={12} /> New</button>
          {collapseButton}
        </div>
      </div>

      <div className="dbc-search">
        <Search size={13} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search connections" className="dbc-input" />
      </div>

      <div className="dbc-list">
        {filtered.map((conn) => {
          const isActive = conn.id === active.id
          const meta = DRIVER_META[conn.driver]
          const state = statuses[conn.id]?.state ?? 'disconnected'
          const sub = conn.driver === 'sqlite' ? `${meta.short} · local` : `${meta.short} · ${conn.host || '—'}`
          return (
            <div key={conn.id} className="dbc-item" data-active={isActive}>
              <button type="button" aria-pressed={isActive} onClick={() => onSelect(conn.id)} className="dbc-item-main">
                <DbDriverIcon driver={conn.driver} size={16} />
                <span className="min-w-0 flex-1">
                  <span className="dbc-item-name">{conn.name}</span>
                  <span className="dbc-item-sub">{sub}{state === 'connected' ? ` · ${statuses[conn.id].latencyMs} ms` : ''}</span>
                </span>
                <span className="dbc-dot" data-state={state} title={state} />
              </button>
              <button
                aria-label={`Connection actions for ${conn.name}`}
                aria-expanded={menuId === conn.id}
                onClick={(e) => { e.stopPropagation(); setMenuId(menuId === conn.id ? '' : conn.id) }}
                className="dbc-icon-btn dbc-item-more"
              >
                <MoreVertical size={13} />
              </button>
              {menuId === conn.id && (
                <>
                  <div className="fixed inset-0 z-20" onClick={(event) => { event.stopPropagation(); setMenuId('') }} />
                  <div className="dbc-menu" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { onDelete(conn.id); setMenuId('') }} disabled={connections.length <= 1}>
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="dbc-form">
        <div className="dbc-label">Database type</div>
        <div className="dbc-drivers">
          {SELECTABLE_DRIVERS.map((driver: SelectableDbDriver) => (
            <button key={driver} type="button" aria-pressed={active.driver === driver} onClick={() => onSetDriver(driver)} className="dbc-driver">
              <DbDriverIcon driver={driver} size={16} mono={active.driver === driver} />
              {DRIVER_META[driver].short}
            </button>
          ))}
        </div>

        <div className="dbc-label">Connection</div>
        <Field label="Name">
          <input value={active.name} onChange={(e) => onUpdate({ name: e.target.value })} className={inputCls} placeholder="Connection name" />
        </Field>
        {active.driver === 'sqlite' ? (
          <>
            <Field label="File path">
              <input value={active.sqlitePath} onChange={(e) => onUpdate({ sqlitePath: e.target.value })} className={cn(inputCls, 'font-mono text-[11px]')} placeholder="C:\data\app.db" />
            </Field>
            <button type="button" onClick={onCreateLocalSQLite} disabled={running} className="dbc-btn dbc-indent">
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
              <label className="dbc-check dbc-indent mb-2">
                <input type="checkbox" checked={active.sslMode !== 'disable' && !!active.sslMode} onChange={(e) => onUpdate({ sslMode: e.target.checked ? 'require' : 'disable' })} />
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
                <label className="dbc-check dbc-indent mb-2">
                  <input type="checkbox" checked={!!active.srv} onChange={(e) => onUpdate({ srv: e.target.checked })} />
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
                  onBlur={() => { cancelSecretSave(); if (editingPassword && passwordDraft) { onUpdate({ password: passwordDraft }); setPasswordDraft(''); setEditingPassword(false) } }}
                  className={cn(inputCls, 'pr-8')}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </Field>
            {isVaultRef(active.password) && <div className="dbc-indent mb-2 flex gap-3"><button type="button" onClick={() => setEditingPassword(true)} className="dbc-link">Change password</button><button type="button" onClick={() => onUpdate({ password: '' })} className="dbc-link" data-tone="danger">Remove password</button></div>}
          </>
        )}
        <Field label="Raw DSN">
          <input
            aria-label="Database DSN"
            value={editingDsn ? dsnDraft : isVaultRef(active.dsn) ? '' : active.dsn}
            onChange={(e) => { setDsnDraft(e.target.value); setEditingDsn(true); if (e.target.value) scheduleSecretSave({ dsn: e.target.value }) }}
            onBlur={() => { cancelSecretSave(); if (editingDsn && dsnDraft) { onUpdate({ dsn: dsnDraft }); setDsnDraft(''); setEditingDsn(false) } }}
            className={cn(inputCls, 'font-mono text-[11px]')}
            placeholder={isVaultRef(active.dsn) ? 'Encrypted DSN saved' : active.driver === 'redis' ? 'redis://127.0.0.1:6379/0' : 'optional connection string'}
          />
        </Field>
        {isVaultRef(active.dsn) && <button type="button" onClick={() => onUpdate({ dsn: '' })} className="dbc-link dbc-indent mb-2" data-tone="danger">Remove DSN</button>}
        <Field label="Idle (min)"><input aria-label="Idle timeout minutes" type="number" min={1} max={120} value={active.idleTimeoutMinutes ?? 15} onChange={(e) => onUpdate({ idleTimeoutMinutes: Math.max(1, Math.min(120, Number(e.target.value))) })} className={inputCls} /></Field>
        <label className="dbc-check"><input type="checkbox" checked={!!active.autoConnect} onChange={(e) => onUpdate({ autoConnect: e.target.checked })} />Auto-connect on selection</label>

        <div className="dbc-actions">
          <button type="button" data-primary="true" disabled={running} onClick={status?.state === 'connected' ? onDisconnect : onConnect} className="dbc-btn dbc-wide">{running ? 'Working…' : status?.state === 'connected' ? 'Disconnect' : 'Connect'}</button>
          <p className="dbc-state">{status?.state ?? 'disconnected'}{status?.state === 'connected' ? ` · ${status.latencyMs} ms` : ''}</p>
          <button type="button" onClick={onTest} disabled={running} className="dbc-btn"><Wand2 size={13} /> Test</button>
          <button type="button" onClick={() => void onVault(vaultPassphrase).then(() => setVaultPassphrase('')).catch(() => undefined)} disabled={credentialState === 'none' || !vaultPassphrase} className="dbc-btn"><Shield size={13} /> Protect</button>
        </div>

        {credentialState !== 'none' && (
          <div className="dbc-note" data-tone="warn">
            <p className="mb-2">Credentials save automatically with local encryption. Optional extra passphrase protection requires unlocking the Vault after restart.</p>
            <input type="password" value={vaultPassphrase} onChange={(event) => setVaultPassphrase(event.target.value)} placeholder="Vault passphrase" className={inputCls} />
          </div>
        )}

        {active.driver === 'redis' && (
          <div className="dbc-note">Run JSON commands: {`{"command":"GET","args":["key"]}`}. Browse keys in the explorer; writes require confirmation. Use rediss:// for TLS.</div>
        )}
        {active.driver === 'mongodb' && (
          <div className="dbc-note" data-tone="ok">
            <b>MongoDB runner is enabled.</b> JSON operations: find, aggregate, insertOne/Many, updateOne/Many, deleteOne/Many, count, listCollections
          </div>
        )}
        {credentialState === 'vault' && <div className="dbc-note" data-tone="ok">Credentials are encrypted at rest and resolved only while this connection is used.</div>}
        {active.credentialWarning && <div className="dbc-note" data-tone="warn">{active.credentialWarning}</div>}
        {active.user && !active.password && !active.dsn && <div className="dbc-note" data-tone="warn">If this connection previously had a password, enter it once again. Older session-only credentials cannot be recovered.</div>}
        {active.driver === 'db2' && <div className="dbc-note" data-tone="warn">This Db2 preset is retained for compatibility, but Db2 is unavailable in this portable build. Select a supported driver.</div>}
      </div>
    </aside>
  )
}
