import { useEffect, useRef, useState } from 'react'
import { Bookmark, Check, ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  deleteBrokerConnectionProfile,
  listBrokerConnectionProfiles,
  loadLastBrokerConnection,
  saveBrokerConnectionProfile,
  saveLastBrokerConnection,
  type BrokerConnectionProfile,
  type BrokerProtocol,
} from '@/lib/brokerConnections'
import { cn } from '@/lib/utils'

interface ConnectionProfilesProps<T extends object> {
  protocol: BrokerProtocol
  config: T
  onLoad: (config: Partial<T>) => void
}

const inputClass = 'h-7 px-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 outline-none focus:border-accent'

export function ConnectionProfiles<T extends object>({ protocol, config, onLoad }: ConnectionProfilesProps<T>) {
  const [profiles, setProfiles] = useState<Array<BrokerConnectionProfile<T>>>([])
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const autosaveRef = useRef<number | null>(null)
  const restoringRef = useRef(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [lastUsed, savedProfiles] = await Promise.all([
        loadLastBrokerConnection<T>(protocol),
        listBrokerConnectionProfiles<T>(protocol),
      ])
      if (!alive) return
      if (lastUsed) {
        restoringRef.current = true
        onLoad(lastUsed)
      }
      setProfiles(savedProfiles)
      setReady(true)
    }
    void load()
    return () => {
      alive = false
      if (autosaveRef.current !== null) window.clearTimeout(autosaveRef.current)
    }
  }, [protocol])

  useEffect(() => {
    if (!ready) return
    if (restoringRef.current) {
      restoringRef.current = false
      return
    }
    if (autosaveRef.current !== null) window.clearTimeout(autosaveRef.current)
    autosaveRef.current = window.setTimeout(() => {
      void saveLastBrokerConnection(protocol, config).catch(() => setStatus('Could not save connection locally'))
    }, 220)
  }, [config, protocol, ready])

  const saveProfile = async () => {
    if (!name.trim()) return
    setSaving(true)
    setStatus('')
    try {
      const profile = await saveBrokerConnectionProfile(protocol, name, config)
      setProfiles((current) => [profile, ...current])
      setName('')
      setStatus('Connection profile saved locally')
    } catch {
      setStatus('Could not save connection profile')
    } finally {
      setSaving(false)
    }
  }

  const applyProfile = (profile: BrokerConnectionProfile<T>) => {
    onLoad(profile.config)
    void saveLastBrokerConnection(protocol, profile.config)
    setStatus(`Loaded ${profile.name}`)
  }

  const removeProfile = async (id: string) => {
    try {
      await deleteBrokerConnectionProfile(id)
      setProfiles((current) => current.filter((profile) => profile.id !== id))
    } catch {
      setStatus('Could not delete connection profile')
    }
  }

  return (
    <div className="mb-3 rounded border border-border-1 bg-surface-0/55">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-text-3 transition-colors hover:text-text-1"
      >
        <Bookmark size={11} className="text-accent" />
        <span className="flex-1 text-left font-medium">Connection profiles</span>
        <span className="text-[10px] text-text-4">{ready ? 'Autosaved locally' : 'Loading...'}</span>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border-1 px-3 py-3">
          <div className="flex gap-1.5">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void saveProfile() }}
              placeholder="Profile name (e.g. Staging)"
              className={cn(inputClass, 'flex-1')}
            />
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={!name.trim() || saving}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Save
            </button>
          </div>
          {profiles.length === 0 ? (
            <p className="text-[10px] text-text-4">No named connection profiles. Current fields still restore automatically after restart.</p>
          ) : (
            profiles.map((profile) => (
              <div key={profile.id} className="flex items-center gap-2 rounded border border-border-1 bg-surface-1 px-2 py-1.5">
                <span className="flex-1 truncate text-xs text-text-2">{profile.name}</span>
                <button type="button" onClick={() => applyProfile(profile)} title="Load profile" className="text-accent hover:text-accent/80">
                  <Check size={11} />
                </button>
                <button type="button" onClick={() => void removeProfile(profile.id)} title="Delete profile" className="text-text-4 hover:text-error">
                  <Trash2 size={11} />
                </button>
              </div>
            ))
          )}
          {status && <p className="text-[10px] text-text-3">{status}</p>}
          <p className="text-[10px] text-text-4">Credentials are stored only in the local workspace database. Use Vault for managed secret reuse.</p>
        </div>
      )}
    </div>
  )
}
