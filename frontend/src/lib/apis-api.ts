// apis-api.ts - Wrapper for ApiCollectionStore Wails bindings.
import {
  GetApiBySlug,
  GetCatalog,
  GetCatalogFromPath,
  SearchApis,
} from '@/wailsjs/go/main/ApiCollectionStore'

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
      SetCollectionsDir: (dirPath: string) => Promise<void>
    }
  }
}

export async function getCatalog(): Promise<ApiCatalog> {
  return GetCatalog()
}

export async function getCatalogFromPath(dirPath: string): Promise<ApiCatalog> {
  return GetCatalogFromPath(dirPath)
}

export async function getApiBySlug(slug: string): Promise<ApiEntry> {
  return GetApiBySlug(slug)
}

export async function searchApis(query: string): Promise<ApiEntry[]> {
  return SearchApis(query)
}
