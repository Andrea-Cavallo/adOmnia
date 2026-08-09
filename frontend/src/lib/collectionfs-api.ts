import { isDesktopRuntime } from './desktopRuntime'
import * as CollectionFSBinding from '@/wailsjs/go/main/CollectionFS'
import type { Collection, Environment, RequestItem } from '@/lib/types'

export interface CollectionFolderDriftReport {
  schemaVersion: string
  collectionId: string
  collection: string
  folderCollectionId: string
  currentHash: string
  folderHash: string
  syncHash?: string
  inSync: boolean
  requestCount: number
  folderRequestCount: number
  message: string
}

export async function exportRequestToFolder(folderPath: string, request: RequestItem): Promise<string> {
  if (!hasCollectionFSBinding()) throw new Error('Collection folder bridge not available')
  return CollectionFSBinding.ExportRequestToFolder(folderPath, JSON.stringify(request))
}

// Wails 3 has no `window.go` global; services come from generated bindings.
export function hasCollectionFSBinding(): boolean {
  return isDesktopRuntime()
}

export async function exportCollectionToFolder(folderPath: string, collection: Collection, environments: Environment[]): Promise<void> {
  if (!hasCollectionFSBinding()) {
    throw new Error('Collection folder bridge not available')
  }
  const exportableEnvironments = environments.map((environment) => ({
    id: environment.id,
    name: environment.name,
    private: environment.private === true,
    variables: environment.variables.map((variable) => ({
      key: variable.key,
      value: variable.value,
      enabled: variable.enabled,
      secret: variable.type === 'secret',
    })),
  }))
  await CollectionFSBinding.ExportCollectionToFolder(folderPath, JSON.stringify(collection), JSON.stringify(exportableEnvironments))
}

export async function importCollectionFromFolder(folderPath: string): Promise<Collection> {
  if (!hasCollectionFSBinding()) {
    throw new Error('Collection folder bridge not available')
  }
  const raw = await CollectionFSBinding.ImportCollectionFromFolder(folderPath)
  return JSON.parse(raw) as Collection
}

export async function inspectCollectionFolder(folderPath: string, collection: Collection): Promise<CollectionFolderDriftReport> {
  if (!hasCollectionFSBinding()) {
    throw new Error('Collection folder bridge not available')
  }
  const raw = await CollectionFSBinding.InspectCollectionFolder(folderPath, JSON.stringify(collection))
  return JSON.parse(raw) as CollectionFolderDriftReport
}
