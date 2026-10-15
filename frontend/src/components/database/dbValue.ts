import { bsonDisplay } from './mongo/bson'

/**
 * Valori delle celle database in forma leggibile (DB-1).
 *
 * Prima ogni contenitore finiva in `Object (2 fields)` / `Array (3)` e i driver SQL
 * restituivano json come testo: la cella non si poteva leggere né ispezionare.
 * Qui i valori diventano strutture, con una preview corta e una forma piatta per
 * le colonne annidate.
 */

/** Sopra questa dimensione il testo non viene parsato come JSON: costa troppo. */
export const MAX_JSON_PARSE_BYTES = 1024 * 1024

/** Quanti figli mostra la preview prima di chiudere con "…" / "+N". */
const PREVIEW_ENTRIES = 2
/** Profondità oltre la quale la preview chiude con `{…}` / `[…]`. */
const PREVIEW_DEPTH = 2
/** Quanti elementi di un array espande `flattenRow` per colonna. */
const FLATTEN_ARRAY_ITEMS = 3

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Chiavi dei wrapper Extended JSON canonici di Mongo ({"$oid": "…"}, {"$date": "…"}, …). */
const BSON_WRAPPERS = new Set([
  '$oid', '$date', '$numberInt', '$numberLong', '$numberDouble', '$numberDecimal',
  '$binary', '$uuid', '$timestamp', '$regularExpression', '$symbol', '$code', '$minKey', '$maxKey',
])

function isBsonWrapper(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  return keys.length === 1 && BSON_WRAPPERS.has(keys[0])
}

/** Un oggetto o un array: gli unici due casi che meritano l'Inspector. */
export function isContainerValue(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isPlainObject(value)
}

/** Testo leggibile di un wrapper BSON (`ObjectId('…')`, ISO, UUID…); `null` se non è un wrapper. */
export function bsonScalarText(value: unknown): string | null {
  return isBsonWrapper(value) ? bsonDisplay(value) : null
}

/**
 * Porta il valore di una cella a una struttura navigabile:
 * - stringhe JSON (`{` o `[` iniziali, sotto `MAX_JSON_PARSE_BYTES`) → oggetto/array parsato;
 * - wrapper BSON canonici (`$oid`, `$date`, `$numberInt`…) → il loro testo leggibile,
 *   ma solo per Mongo: su SQL `{"$oid": …}` è un oggetto come un altro.
 * Tutto il resto (incluso il non-JSON) resta com'è.
 */
export function normalizeCell(value: unknown, driver = ''): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trimStart()
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && value.length <= MAX_JSON_PARSE_BYTES) {
      try {
        return normalizeCell(JSON.parse(value), driver)
      } catch {
        return value
      }
    }
    return value
  }
  if (Array.isArray(value)) return value.map((item) => normalizeCell(item, driver))
  if (!isPlainObject(value)) return value
  if (driver === 'mongodb' && isBsonWrapper(value)) {
    const key = Object.keys(value)[0]
    // I numeri restano numeri (allineamento a destra, confronti); il resto dei
    // wrapper diventa il suo testo leggibile: ObjectId('…'), ISO, UUID('…')…
    if (key === '$numberInt' || key === '$numberLong' || key === '$numberDouble' || key === '$numberDecimal') {
      const parsed = Number((value as Record<string, unknown>)[key])
      return Number.isFinite(parsed) ? parsed : bsonDisplay(value)
    }
    return bsonDisplay(value)
  }
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) out[key] = normalizeCell(child, driver)
  return out
}

function previewAny(value: unknown, depth: number): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (depth >= PREVIEW_DEPTH) return '[…]'
    const items = value.slice(0, PREVIEW_ENTRIES).map((item) => previewAny(item, depth + 1))
    const more = value.length - PREVIEW_ENTRIES
    return `[ ${items.join(', ')}${more > 0 ? `, +${more}` : ''} ]`
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    if (depth >= PREVIEW_DEPTH) return '{…}'
    const shown = entries.slice(0, PREVIEW_ENTRIES).map(([key, child]) => `${key}: ${previewAny(child, depth + 1)}`)
    const more = entries.length - PREVIEW_ENTRIES
    return `{ ${shown.join(', ')}${more > 0 ? ', …' : ''} }`
  }
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}

/**
 * Anteprima monoriga di qualunque valore:
 * `{ street: "Via Roma", city: "Milano" }`, `[ "a", "b", +1 ]`, `{…}` oltre la profondità.
 * Non esiste più il caso in cui l'unica cosa leggibile è `Object (3 fields)`.
 */
export function previewValue(value: unknown, maxLen = 60): string {
  const text = previewAny(value, 0)
  return text.length > maxLen ? `${text.slice(0, Math.max(1, maxLen - 1))}…` : text
}

/**
 * Appiattisce una riga in colonne puntate (`address.city`), con gli array espansi
 * come `tag[0]`, `tag[1]`… fino a `maxArrayItems` e poi `tag[…]` con quanti ne restano.
 * Oltre `depth` i contenitori restano come preview monoriga.
 */
export function flattenRow(row: Record<string, unknown>, depth = 2, maxArrayItems = FLATTEN_ARRAY_ITEMS): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const walk = (value: unknown, key: string, level: number) => {
    if (Array.isArray(value)) {
      if (value.length === 0 || level >= depth) {
        out[key] = previewValue(value)
        return
      }
      value.slice(0, maxArrayItems).forEach((item, index) => walk(item, `${key}[${index}]`, level + 1))
      if (value.length > maxArrayItems) out[`${key}[…]`] = `+${value.length - maxArrayItems} more`
      return
    }
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      if (level >= depth) {
        out[key] = previewValue(value)
        return
      }
      for (const [childKey, childValue] of Object.entries(value)) {
        walk(childValue, key ? `${key}.${childKey}` : childKey, level + 1)
      }
      return
    }
    out[key] = value
  }
  for (const [key, value] of Object.entries(row)) walk(value, key, 1)
  return out
}
