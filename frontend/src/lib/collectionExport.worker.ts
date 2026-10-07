import { exportAllCollectionsPayload, exportCollectionPayload, exportNodePayload, type ExportFormat } from './collectionTransfer'
import { collectionToOAS } from './oasExport'
import type { Collection, TreeNode } from './types'

export type CollectionExportJob =
  | { kind: 'all'; collections: Collection[]; format: ExportFormat }
  | { kind: 'collection'; collection: Collection; format: ExportFormat }
  | { kind: 'node'; collection: Collection; node: TreeNode; format: ExportFormat }
  | { kind: 'oas-yaml'; collection: Collection }

export function createCollectionExport(job: CollectionExportJob): string {
  switch (job.kind) {
    case 'all': return exportAllCollectionsPayload(job.collections, job.format)
    case 'collection': return exportCollectionPayload(job.collection, job.format)
    case 'node': return exportNodePayload(job.collection, job.node, job.format)
    case 'oas-yaml': return collectionToOAS(job.collection, 'yaml')
  }
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  self.onmessage = (event: MessageEvent<CollectionExportJob>) => {
    try {
      self.postMessage({ text: createCollectionExport(event.data) })
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : String(error) })
    }
  }
}
