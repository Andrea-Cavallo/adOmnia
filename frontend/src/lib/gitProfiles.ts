import { clearManagedSecret, hydrateManagedSecret, persistManagedSecret } from '@/lib/managedSecrets'

const KEY = 'adomnia.git.profiles'

function tokenScope(id: string): string {
  return `git-profile:${id}:token`
}

export interface GitProfile {
  id: string
  label: string
  name: string
  email: string
  hostPattern: string
  autoApply: boolean
  provider: 'github' | 'gitlab' | 'bitbucket' | 'azure'
  baseURL: string
  username: string
  tokenRef: string
}

export function loadGitProfiles(): GitProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    const loaded = parsed.filter((item): item is GitProfile => Boolean(item && typeof item === 'object' && typeof (item as GitProfile).id === 'string')).map((item) => {
      const storedToken = typeof item.tokenRef === 'string' ? item.tokenRef : ''
      if (storedToken && !storedToken.trim().startsWith('vault:')) {
        persistManagedSecret(tokenScope(item.id), storedToken)
      }
      return {
        ...item,
        provider: item.provider || 'github',
        baseURL: item.baseURL || '',
        username: item.username || '',
        tokenRef: storedToken && !storedToken.trim().startsWith('vault:')
          ? storedToken
          : hydrateManagedSecret(tokenScope(item.id), storedToken),
      }
    })
    persist(loaded)
    return loaded
  } catch { return [] }
}

function persist(profiles: GitProfile[]) {
  const safeProfiles = profiles.map((profile) => ({
    ...profile,
    tokenRef: persistManagedSecret(tokenScope(profile.id), profile.tokenRef),
  }))
  try { localStorage.setItem(KEY, JSON.stringify(safeProfiles)) } catch { /* best effort */ }
}

export function saveGitProfile(profiles: GitProfile[], profile: Omit<GitProfile, 'id'> & { id?: string }): GitProfile[] {
  const id = profile.id || `git-profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const next = [{ ...profile, id }, ...profiles.filter((item) => item.id !== id)]
  persist(next)
  return next
}

export function removeGitProfile(profiles: GitProfile[], id: string): GitProfile[] {
  const next = profiles.filter((profile) => profile.id !== id)
  persist(next)
  clearManagedSecret(tokenScope(id))
  return next
}

export function matchingGitProfile(profiles: GitProfile[], remoteURLs: string[]): GitProfile | undefined {
  const haystack = remoteURLs.join('\n').toLowerCase()
  return profiles.find((profile) => profile.autoApply && profile.hostPattern.trim() && haystack.includes(profile.hostPattern.trim().toLowerCase()))
}
