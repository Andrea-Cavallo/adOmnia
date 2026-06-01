/**
 * Safe wrapper for localStorage.setItem.
 *
 * Catches QuotaExceededError and the Firefox variant NS_ERROR_DOM_QUOTA_REACHED
 * so the app never crashes silently when local storage is full.
 *
 * On quota failure:
 * - fires adomnia:save-error, picked up by StatusBar for a short toast
 * - fires adomnia:storage-quota-exceeded, used by the persistent warning banner
 *
 * On any other write error:
 * - fires adomnia:save-error only
 */
export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    const isQuota =
      e instanceof DOMException &&
      (e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        e.code === 22)

    const msg = isQuota
      ? 'Storage quota exceeded - export your workspace now to avoid data loss'
      : e instanceof Error
        ? e.message
        : 'localStorage write failed'

    window.dispatchEvent(new CustomEvent('adomnia:save-error', { detail: msg }))

    if (isQuota) {
      window.dispatchEvent(new CustomEvent('adomnia:storage-quota-exceeded'))
    }
  }
}
