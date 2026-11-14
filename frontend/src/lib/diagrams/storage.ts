/**
 * Diagram persistence in adOmnia's bbolt store (bucket "diagrams", through the generic Storage*
 * bindings). Each diagram has a light `meta:<id>` entry for the list and its JSON under `doc:<id>`,
 * so listing never reads whole diagrams. The backend is injected, so the repository is tested in memory.
 */
import { StorageDelete, StorageGet, StorageList, StoragePut } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/app'
import { storageSchema } from '@/lib/storageSchemas'
import { summaryOf, type DiagramDocument, type DiagramSummary } from './model'
import { parseDiagram, serializeDiagram } from './serialization'

export interface StorageBackend {
  get: (key: string) => Promise<string>
  put: (key: string, value: string) => Promise<void>
  list: (prefix: string) => Promise<string[]>
  remove: (key: string) => Promise<void>
}

export interface DiagramRepository {
  list: () => Promise<DiagramSummary[]>
  load: (id: string) => Promise<DiagramDocument | null>
  save: (doc: DiagramDocument) => Promise<void>
  remove: (id: string) => Promise<void>
}

const metaKey = (id: string) => `meta:${id}`
const docKey = (id: string) => `doc:${id}`
const META_PREFIX = 'meta:'

export function createDiagramRepository(backend: StorageBackend): DiagramRepository {
  return {
    async list() {
      const keys = await backend.list(META_PREFIX)
      const summaries = await Promise.all(keys.map(async (key) => {
        try {
          const meta = JSON.parse(await backend.get(key)) as DiagramSummary
          return typeof meta.id === 'string' ? [meta] : []
        } catch {
          return [] // a damaged entry must not hide the others
        }
      }))
      return summaries.flat().sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async load(id) {
      const raw = await backend.get(docKey(id))
      return raw ? parseDiagram(raw) : null
    },
    async save(doc) {
      // The document first: a meta entry never points to a diagram that is not there.
      await backend.put(docKey(doc.id), serializeDiagram(doc))
      await backend.put(metaKey(doc.id), JSON.stringify(summaryOf(doc)))
    },
    async remove(id) {
      await backend.remove(metaKey(id))
      await backend.remove(docKey(id))
    },
  }
}

const BUCKET = storageSchema('diagrams').bucket

/** The repository on adOmnia's local store. */
export const diagramRepository = createDiagramRepository({
  get: async (key) => (await StorageGet(BUCKET, key)) ?? '',
  put: async (key, value) => { await StoragePut(BUCKET, key, value) },
  list: async (prefix) => (await StorageList(BUCKET, prefix)) ?? [],
  remove: async (key) => { await StorageDelete(BUCKET, key) },
})

/** An in-memory backend, for tests and for previews outside the desktop shell. */
export function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed))
  return {
    data,
    get: async (key) => data.get(key) ?? '',
    put: async (key, value) => { data.set(key, value) },
    list: async (prefix) => [...data.keys()].filter((key) => key.startsWith(prefix)),
    remove: async (key) => { data.delete(key) },
  }
}
