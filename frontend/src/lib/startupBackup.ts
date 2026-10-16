import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { safeSetItem } from './safeLocalStorage'
import type { Collection, Environment } from './types'

export const STARTUP_BACKUP_FORMAT = 'adomnia-workspace-backup'
export const STARTUP_BACKUP_VERSION = '1.0'
export const STARTUP_BACKUP_LOCAL_KEY = 'adomnia.workspace.backup'

/**
 * Startup snapshot of collections and environments, captured before later
 * store mutations can alter it. Restorable from the Workspace panel; this is
 * an internal safety net, not the portable `.adomnia` export format.
 */
export interface StartupBackupSnapshot {
  format: typeof STARTUP_BACKUP_FORMAT
  version: string
  backedUpAt: string
  collections: Collection[]
  environments: Environment[]
  activeEnvId?: string | null
}

export function buildStartupBackupSnapshot(input: {
  collections: Collection[]
  environments: Environment[]
  activeEnvId?: string | null
}): StartupBackupSnapshot {
  return {
    format: STARTUP_BACKUP_FORMAT,
    version: STARTUP_BACKUP_VERSION,
    backedUpAt: new Date().toISOString(),
    collections: input.collections,
    environments: input.environments,
    activeEnvId: input.activeEnvId ?? null,
  }
}

/** Backend-owned snapshot; the previous renderer key remains the browser fallback. */
export async function persistStartupBackup(snapshot: unknown): Promise<void> {
  try {
    const serialized = JSON.stringify(snapshot)
    try {
      await StoragePut('workspace', 'backup', serialized)
    } catch {
      safeSetItem(STARTUP_BACKUP_LOCAL_KEY, serialized)
    }
  } catch {
    // Backup errors must never block startup.
  }
}

/** Validates a stored snapshot; anything malformed is treated as no backup. */
export function parseStartupBackup(raw: string | null | undefined): StartupBackupSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StartupBackupSnapshot> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.format !== STARTUP_BACKUP_FORMAT) return null
    if (typeof parsed.version !== 'string' || !parsed.version.startsWith('1.')) return null
    if (!Array.isArray(parsed.collections) || !Array.isArray(parsed.environments)) return null
    return {
      format: STARTUP_BACKUP_FORMAT,
      version: parsed.version,
      backedUpAt: typeof parsed.backedUpAt === 'string' ? parsed.backedUpAt : '',
      collections: parsed.collections,
      environments: parsed.environments,
      activeEnvId: parsed.activeEnvId ?? null,
    }
  } catch {
    return null
  }
}

/** Reads the startup snapshot: backend storage first, legacy renderer key as fallback. */
export async function readStartupBackup(): Promise<StartupBackupSnapshot | null> {
  let backendRaw = ''
  try {
    backendRaw = await StorageGet('workspace', 'backup')
  } catch {
    // Backend unavailable: fall back to the renderer copy below.
  }
  const backend = parseStartupBackup(backendRaw)
  if (backend) return backend
  try {
    return parseStartupBackup(localStorage.getItem(STARTUP_BACKUP_LOCAL_KEY))
  } catch {
    return null
  }
}
