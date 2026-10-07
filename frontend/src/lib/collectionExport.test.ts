import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollectionExport } from './collectionExport.worker'
import { exportAllCollectionsPayload, exportCollectionPayload, exportNodePayload, type ExportFormat } from './collectionTransfer'
import { collectionToOAS } from './oasExport'
import type { Collection, TreeNode } from './types'

const node = { id: 'req-1', type: 'request', name: 'Health', method: 'GET', url: 'https://example.test/health', params: [], headers: [], bodies: [], activeBodyIdx: 0, auth: { type: 'none' } } as unknown as TreeNode
const collection = { id: 'col-1', name: 'Service', children: [node] } as Collection
const formats: ExportFormat[] = ['adomnia', 'postman', 'insomnia', 'bruno', 'openapi', 'swagger2']

describe('background collection export', () => {
  // A single request is exported inside a new collection with a random id: both sides must draw the same one.
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0.42) })
  afterEach(() => { vi.restoreAllMocks() })

  for (const format of formats) {
    it(`preserves ${format} payloads for collection, node and all`, () => {
      expect(createCollectionExport({ kind: 'collection', collection, format })).toBe(exportCollectionPayload(collection, format))
      expect(createCollectionExport({ kind: 'node', collection, node, format })).toBe(exportNodePayload(collection, node, format))
      expect(createCollectionExport({ kind: 'all', collections: [collection], format })).toBe(exportAllCollectionsPayload([collection], format))
    })
  }

  it('preserves OpenAPI YAML output', () => {
    expect(createCollectionExport({ kind: 'oas-yaml', collection })).toBe(collectionToOAS(collection, 'yaml'))
  })
})
