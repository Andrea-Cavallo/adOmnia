// Code Studio used to be "Go Studio" and kept its state under `adomnia.goide.*`.
// Copy those entries to `adomnia.codestudio.*` once; the old keys stay so a downgrade still works.
const OLD_PREFIX = 'adomnia.goide.'
const NEW_PREFIX = 'adomnia.codestudio.'

export function migrateLegacyStorageKeys(target?: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>): number {
  let copied = 0
  try {
    const storage = target ?? localStorage
    const legacy: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(OLD_PREFIX)) legacy.push(key)
    }
    for (const key of legacy) {
      const next = NEW_PREFIX + key.slice(OLD_PREFIX.length)
      const value = storage.getItem(key)
      if (value !== null && storage.getItem(next) === null) {
        storage.setItem(next, value)
        copied++
      }
    }
  } catch {
    // Storage can be unavailable or full; the app then starts with defaults.
  }
  return copied
}

migrateLegacyStorageKeys()
