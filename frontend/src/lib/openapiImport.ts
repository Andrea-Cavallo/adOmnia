// Thin wrapper for the CollectionTree file upload feature
// Delegates to the full parseOpenAPI parser in openapi.ts

import { parseOpenAPI } from './openapi'
import type { Collection } from './types'

export function openApiToCollection(raw: string): Collection {
  const collections = parseOpenAPI(raw)
  if (collections.length === 0) {
    throw new Error('No endpoints found in spec.')
  }
  // Merge all collections into one for the simple import path
  const merged: Collection = {
    id: collections[0].id,
    name: collections.length === 1 ? collections[0].name : 'Imported API',
    color: collections[0].color,
    _openapiSpec: raw,
    children: collections.flatMap((c) => c.children),
  }
  return merged
}
