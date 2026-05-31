// apis-api.ts — Wrapper for ApiCollectionStore Wails bindings.

export interface ApiLink {
  name: string
  url: string
}

export interface ApiEntry {
  name: string
  slug: string
  description: string
  categories: string[]
  type: string
  isFree: boolean
  links?: ApiLink[]
}

export interface ApiCategory {
  name: string
  emoji: string
  count: number
  apis: ApiEntry[]
}

export interface ApiCatalog {
  categories: ApiCategory[]
  emojiMap: Record<string, string>
  total: number
}

declare global {
  interface WailsGoMain {
    ApiCollectionStore: {
      GetCatalog: () => Promise<ApiCatalog>
      GetCatalogFromPath: (dirPath: string) => Promise<ApiCatalog>
      GetApiBySlug: (slug: string) => Promise<ApiEntry>
      SearchApis: (query: string) => Promise<ApiEntry[]>
    }
  }
}

function getApiCollectionStore() {
  return window.go?.main?.ApiCollectionStore
}

export async function getCatalog(): Promise<ApiCatalog> {
  const store = getApiCollectionStore()
  if (!store) throw new Error('ApiCollectionStore available only in desktop app.')
  return (await store.GetCatalog()) as ApiCatalog
}

export async function getCatalogFromPath(dirPath: string): Promise<ApiCatalog> {
  const store = getApiCollectionStore()
  if (!store) throw new Error('ApiCollectionStore available only in desktop app.')
  return (await store.GetCatalogFromPath(dirPath)) as ApiCatalog
}

export async function getApiBySlug(slug: string): Promise<ApiEntry> {
  const store = getApiCollectionStore()
  if (!store) throw new Error('ApiCollectionStore available only in desktop app.')
  return (await store.GetApiBySlug(slug)) as ApiEntry
}

export async function searchApis(query: string): Promise<ApiEntry[]> {
  const store = getApiCollectionStore()
  if (!store) throw new Error('ApiCollectionStore available only in desktop app.')
  return (await store.SearchApis(query)) as ApiEntry[]
}
