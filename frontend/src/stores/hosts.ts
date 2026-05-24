import { create } from 'zustand'
import type { HostEntry, HostsProfile } from '@/lib/types'
import { uid, blankHostEntry } from '@/lib/types'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { debouncedSave } from '@/lib/storeSave'

const BUCKET = 'hosts'
const KEY = 'all'

interface HostsState {
  profiles: HostsProfile[]
  activeProfileId: string | null
  loaded: boolean
  loadError: boolean
  load: () => Promise<void>
  save: () => void
  setActiveProfile: (id: string | null) => void
  addProfile: (name: string) => HostsProfile
  deleteProfile: (id: string) => void
  renameProfile: (id: string, name: string) => void
  updateEntries: (profileId: string, entries: HostEntry[]) => void
  getActiveEntries: () => HostEntry[]
}

export const useHostsStore = create<HostsState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  loaded: false,
  loadError: false,

  load: async () => {
    try {
      const raw = await StorageGet(BUCKET, KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        set({
          profiles: parsed.profiles ?? [],
          activeProfileId: parsed.activeProfileId ?? null,
          loaded: true,
          loadError: false,
        })
      } else {
        set({ loaded: true, loadError: false })
      }
    } catch {
      set({ loaded: true, loadError: true })
    }
  },

  save: () => {
    const s = get()
    if (!s.loaded || s.loadError) return
    const { profiles, activeProfileId } = s
    debouncedSave('hosts', () => StoragePut(BUCKET, KEY, JSON.stringify({ profiles, activeProfileId })))
  },

  setActiveProfile: (id) => {
    set({ activeProfileId: id })
    get().save()
  },

  addProfile: (name) => {
    const profile: HostsProfile = {
      id: uid(),
      name,
      entries: [blankHostEntry()],
    }
    set((s) => ({ profiles: [...s.profiles, profile] }))
    get().save()
    return profile
  },

  deleteProfile: (id) => {
    set((s) => ({
      profiles: s.profiles.filter((p) => p.id !== id),
      activeProfileId: s.activeProfileId === id ? null : s.activeProfileId,
    }))
    get().save()
  },

  renameProfile: (id, name) => {
    set((s) => ({
      profiles: s.profiles.map((p) => (p.id === id ? { ...p, name } : p)),
    }))
    get().save()
  },

  updateEntries: (profileId, entries) => {
    set((s) => ({
      profiles: s.profiles.map((p) => (p.id === profileId ? { ...p, entries } : p)),
    }))
    get().save()
  },

  getActiveEntries: () => {
    const { profiles, activeProfileId } = get()
    if (!activeProfileId) return []
    const profile = profiles.find((p) => p.id === activeProfileId)
    if (!profile) return []
    return profile.entries.filter((e) => e.enabled && e.host && e.ip)
  },
}))
