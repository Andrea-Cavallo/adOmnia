import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'

export async function appendMockEndpoints(endpoints: unknown[]): Promise<void> {
  const raw = await StorageGet('mock', 'endpoints').catch(() => '')
  let existing: unknown[] = []
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) existing = parsed
    } catch {
      existing = []
    }
  }
  await StoragePut('mock', 'endpoints', JSON.stringify([...existing, ...endpoints]))
  document.dispatchEvent(new CustomEvent('adomnia:mock-endpoints-updated'))
}
