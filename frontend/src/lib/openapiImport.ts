// Thin wrapper for the CollectionTree file upload feature
// Delegates to the full parseOpenAPI parser in openapi.ts

import { parseOpenAPI } from './openapi'
import { parseYamlLenient } from './yamlParse'
import { uid } from './types'
import type { Collection, FolderItem } from './types'

// specTitle recovers the real API title for the merged collection name. The
// per-tag collections from parseOpenAPI drop it when every operation is tagged
// (the untagged collection that carries the title is empty and discarded), so
// we read it back from the raw spec.
function specTitle(raw: string): string {
  try {
    const doc = parseYamlLenient(raw) as { info?: { title?: string } } | null
    const title = doc?.info?.title
    return typeof title === 'string' && title.trim() ? title.trim() : 'Imported API'
  } catch {
    return 'Imported API'
  }
}

export function openApiToCollection(raw: string): Collection {
  const collections = parseOpenAPI(raw)
  if (collections.length === 0) {
    throw new Error('No endpoints found in spec.')
  }
  if (collections.length === 1) {
    return { ...collections[0], _openapiSpec: raw }
  }
  // Preserve tag grouping as nested folders instead of flattening it away.
  const folders: FolderItem[] = collections.map((c) => ({
    id: c.id,
    name: c.name,
    type: 'folder',
    children: c.children,
  }))
  return {
    id: uid(),
    name: specTitle(raw),
    color: collections[0].color,
    _openapiSpec: raw,
    children: folders,
  }
}
