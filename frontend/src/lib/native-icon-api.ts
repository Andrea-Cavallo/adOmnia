import { isDesktopRuntime } from './desktopRuntime'
import { SetNativeIconMode } from '../../bindings/adomnia/app'

let pending = Promise.resolve()

// Serialize native updates so rapid theme switches finish with the latest icon.
export function syncNativeIcon(mode: 'dark' | 'light'): void {
  if (!isDesktopRuntime()) return
  pending = pending.then(() => SetNativeIconMode(mode)).catch(error => {
    console.warn('[native-icon] Could not update the desktop icon', error)
  })
}
