import type { ApiCatalog, ApiEntry } from '@/lib/apis-api'
import { getWailsMainBinding } from '@/lib/wailsBindings'

type ApiCollectionBinding = {
  GetApiBySlug: (slug: string) => Promise<ApiEntry>
  GetCatalog: () => Promise<ApiCatalog>
  GetCatalogFromPath: (dirPath: string) => Promise<ApiCatalog>
  SearchApis: (query: string) => Promise<ApiEntry[]>
  SetCollectionsDir: (dirPath: string) => Promise<void>
}

function binding(): ApiCollectionBinding {
  return getWailsMainBinding<ApiCollectionBinding>('ApiCollectionStore')
}

export function GetApiBySlug(slug: string): Promise<ApiEntry> {
  return binding().GetApiBySlug(slug)
}

export function GetCatalog(): Promise<ApiCatalog> {
  return binding().GetCatalog()
}

export function GetCatalogFromPath(dirPath: string): Promise<ApiCatalog> {
  return binding().GetCatalogFromPath(dirPath)
}

export function SearchApis(query: string): Promise<ApiEntry[]> {
  return binding().SearchApis(query)
}

export function SetCollectionsDir(dirPath: string): Promise<void> {
  return binding().SetCollectionsDir(dirPath)
}
