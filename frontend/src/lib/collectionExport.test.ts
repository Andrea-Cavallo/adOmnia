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
  beforeEach(() => {
    // uid() prende l'entropia da getRandomValues (non più Math.random): lo si rende deterministico
    // con un valore costante, come faceva il mock di Math.random.
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => { array.fill(7); return array }) as unknown as typeof crypto.getRandomValues)
  })
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
