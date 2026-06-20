const KEY = 'adomnia.git.profiles'

export interface GitProfile {
  id: string
  label: string
  name: string
  email: string
  hostPattern: string
  autoApply: boolean
}

export function loadGitProfiles(): GitProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is GitProfile => Boolean(item && typeof item === 'object' && typeof (item as GitProfile).id === 'string'))
  } catch { return [] }
}

function persist(profiles: GitProfile[]) {
  try { localStorage.setItem(KEY, JSON.stringify(profiles)) } catch { /* best effort */ }
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
  return next
}

export function matchingGitProfile(profiles: GitProfile[], remoteURLs: string[]): GitProfile | undefined {
  const haystack = remoteURLs.join('\n').toLowerCase()
  return profiles.find((profile) => profile.autoApply && profile.hostPattern.trim() && haystack.includes(profile.hostPattern.trim().toLowerCase()))
}
