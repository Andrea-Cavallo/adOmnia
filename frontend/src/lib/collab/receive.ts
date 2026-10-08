import { cloneCollection } from '@/lib/collectionTransfer'
import { uid, type Collection, type Environment, type EnvVariable, type RequestItem } from '@/lib/types'

/** Valore che il backend mette al posto dei segreti prima di condividere. */
export const REDACTED = '***REDACTED***'

export type ReceivedContent =
  | { kind: 'collection'; collection: Collection }
  | { kind: 'request'; request: RequestItem }
  | { kind: 'environments'; environments: Environment[] }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Un segreto redatto torna vuoto: l'utente lo inserisce da sé, mai "***REDACTED***" come valore reale.
function clearRedacted<T>(value: T): T {
  if (value === REDACTED) return '' as T
  if (Array.isArray(value)) return value.map(clearRedacted) as T
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clearRedacted(v)])) as T
  return value
}

/**
 * Converte il contenuto ricevuto (non fidato) in oggetti importabili con ID nuovi,
 * così ricevere due volte la stessa collection non collide con quella esistente.
 */
export function parseReceived(kind: string, title: string, data: unknown, from: string): ReceivedContent {
  const clean = clearRedacted(data)
  if (kind === 'collection') {
    if (!isObject(clean) || !Array.isArray(clean.children)) throw new Error('Collection ricevuta non valida')
    const source = clean as unknown as Collection
    return { kind, collection: cloneCollection(source, `${String(source.name || title)} (da ${from})`) }
  }
  if (kind === 'request') {
    if (!isObject(clean) || clean.type !== 'request' || typeof clean.url !== 'string' || !['headers', 'params', 'bodies'].every((k) => Array.isArray(clean[k]))) throw new Error('Request ricevuta non valida')
    const source = clean as unknown as RequestItem
    const wrapper = cloneCollection({ id: '', name: '', children: [source] }, '')
    return { kind, request: wrapper.children[0] as RequestItem }
  }
  if (kind === 'environments') {
    if (!Array.isArray(clean)) throw new Error('Environment ricevuti non validi')
    const environments = clean.filter(isObject).map((env): Environment => ({
      id: uid(),
      name: `${String(env.name || 'Environment')} (da ${from})`,
      variables: (Array.isArray(env.variables) ? env.variables : []).filter(isObject).map((v): EnvVariable => ({
        id: uid(),
        key: String(v.key ?? ''),
        value: String(v.value ?? ''),
        enabled: v.enabled !== false,
        type: v.type === 'secret' ? 'secret' : 'text',
      })),
    }))
    return { kind, environments }
  }
  throw new Error(`Tipo di contenuto sconosciuto: ${kind}`)
}

/** True se il contenuto porta script pre/post/test: girano nel renderer quando l'utente invia la request. */
export function containsScripts(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsScripts)
  if (!isObject(value)) return false
  return Object.entries(value).some(([key, child]) =>
    (['scripts', 'preScript', 'postScript'].includes(key) && hasCode(child)) || containsScripts(child))
}

function hasCode(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== ''
  return isObject(value) && Object.values(value).some((v) => typeof v === 'string' && v.trim() !== '')
}

/** Environment pronti alla condivisione: i segreti restano a casa (il backend li ripulisce comunque). */
export function shareableEnvironments(environments: Environment[]): Environment[] {
  return environments
    .filter((env) => !env.private)
    .map((env) => ({ ...env, variables: env.variables.map((v) => (v.type === 'secret' ? { ...v, value: '' } : v)) }))
}
