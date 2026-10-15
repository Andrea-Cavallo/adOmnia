import { StoragePut } from '@/wailsjs/go/main/App'
import { safeSetItem } from './safeLocalStorage'

/** Backend-owned snapshot; the previous renderer key remains the browser fallback. */
export async function persistStartupBackup(snapshot: unknown): Promise<void> {
  try {
    const serialized = JSON.stringify(snapshot)
    try {
      await StoragePut('workspace', 'backup', serialized)
    } catch {
      safeSetItem('adomnia.workspace.backup', serialized)
    }
  } catch {
    // Backup errors must never block startup.
  }
}
