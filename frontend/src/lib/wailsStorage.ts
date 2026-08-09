import * as AppBindings from '../../bindings/adomnia/app'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { safeSetItem } from './safeLocalStorage'

type WailsStorageBinding = {
  StorageGet?: unknown
  StoragePut?: unknown
}

function storageKey(bucket: string, key: string) {
  return `adomnia.${bucket}.${key}`
}

// Wails 3 has no `window.go` global; services come from generated bindings.
function binding(): WailsStorageBinding | undefined {
  return AppBindings as unknown as WailsStorageBinding
}

export async function safeStorageGet(bucket: string, key: string): Promise<string> {
  if (typeof binding()?.StorageGet === 'function') {
    try {
      return await StorageGet(bucket, key)
    } catch {
      // Development browser fallback. Wails storage remains the primary path in desktop.
    }
  }

  try {
    return localStorage.getItem(storageKey(bucket, key)) ?? ''
  } catch {
    return ''
  }
}

export async function safeStoragePut(bucket: string, key: string, value: string): Promise<void> {
  safeSetItem(storageKey(bucket, key), value)

  if (typeof binding()?.StoragePut !== 'function') return
  try {
    await StoragePut(bucket, key, value)
  } catch {
    // localStorage already carries the latest value for the running browser session.
  }
}
