import * as CollectionFSBinding from '@/wailsjs/go/main/CollectionFS'
import type { Collection } from '@/lib/types'

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

export function hasCollectionFSBinding(): boolean {
  const w = window as typeof window & { go?: { main?: { CollectionFS?: unknown } } }
  return Boolean(w.go?.main?.CollectionFS)
}

export async function exportCollectionToFolder(folderPath: string, collection: Collection): Promise<void> {
  if (!hasCollectionFSBinding()) {
    throw new Error('Collection folder bridge not available')
  }
  await CollectionFSBinding.ExportCollectionToFolder(folderPath, JSON.stringify(collection))
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
