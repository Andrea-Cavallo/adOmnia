import { parse, stringify } from 'yaml'
import { exportToOpenApi } from '@/lib/openapi'
import type { Collection } from '@/lib/types'

export type OASExportFormat = 'yaml' | 'json'

/**
 * Convert one or more Collections to an OpenAPI document string.
 *
 * Reuses the canonical {@link exportToOpenApi} serializer (OpenAPI 3.0.3, with
 * security schemes, headers, query params, request bodies and base-URL inference)
 * and optionally re-emits the result as YAML. This keeps a single source of truth
 * for the OAS mapping while giving callers the YAML round-trip format expected by
 * spec-first tooling (P13 schema components, P19 doc generator).
 */
export function collectionsToOAS(collections: Collection[], format: OASExportFormat = 'yaml'): string {
  const json = exportToOpenApi(collections)
  if (format === 'json') return json
  const doc = parse(json)
  // lineWidth: 0 disables line wrapping so long URLs/descriptions stay on one line.
  return stringify(doc, { lineWidth: 0 })
}

/** Convenience wrapper for a single collection. */
export function collectionToOAS(collection: Collection, format: OASExportFormat = 'yaml'): string {
  return collectionsToOAS([collection], format)
}
