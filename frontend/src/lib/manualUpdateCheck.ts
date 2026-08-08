import { CheckForUpdate, type UpdateInfo } from '@/wailsjs/go/main/App'

export type ManualUpdateResult =
  | { kind: 'current' }
  | { kind: 'available'; version: string; url: string }
  | { kind: 'dev' }
  | { kind: 'error' }

type UpdateCheck = () => Promise<UpdateInfo>

/**
 * Runs the release check only in response to an explicit user action.
 * Importing this module has no side effects and never contacts GitHub.
 */
export async function runManualUpdateCheck(
  checkForUpdate: UpdateCheck = CheckForUpdate,
): Promise<ManualUpdateResult> {
  try {
    const info = await checkForUpdate()
    if (info.isDev) return { kind: 'dev' }
    if (info.updateAvailable) {
      return { kind: 'available', version: info.latestVersion, url: info.releaseUrl }
    }
    return { kind: 'current' }
  } catch {
    return { kind: 'error' }
  }
}
