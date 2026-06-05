import { parse, stringify } from 'yaml'
import { exportToOpenApi } from '@/lib/openapi'
import { useSchemasStore } from '@/stores/schemas'
import type { Collection } from '@/lib/types'

export type OASExportFormat = 'yaml' | 'json'

interface OASComponents {
  schemas?: Record<string, unknown>
  [key: string]: unknown
}

interface OASDoc {
  components?: OASComponents
  [key: string]: unknown
}

/**
 * Merges the workspace schema registry (P13) into an OAS document's
 * `components.schemas`, preserving any schemas already emitted by the
 * canonical exporter. Invalid JSON Schema entries are skipped.
 */
function injectRegistrySchemas(doc: OASDoc): OASDoc {
  const entries = useSchemasStore.getState().schemas
  if (entries.length === 0) return doc

  const registry: Record<string, unknown> = {}
  for (const entry of entries) {
    try {
      registry[entry.name] = JSON.parse(entry.schema)
    } catch {
      /* skip invalid */
    }
  }
  if (Object.keys(registry).length === 0) return doc

  return {
    ...doc,
    components: {
      ...doc.components,
      schemas: { ...(doc.components?.schemas ?? {}), ...registry },
    },
  }
}

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
  const doc = injectRegistrySchemas(parse(json) as OASDoc)
  if (format === 'json') return JSON.stringify(doc, null, 2)
  // lineWidth: 0 disables line wrapping so long URLs/descriptions stay on one line.
  return stringify(doc, { lineWidth: 0 })
}

/** Convenience wrapper for a single collection. */
export function collectionToOAS(collection: Collection, format: OASExportFormat = 'yaml'): string {
  return collectionsToOAS([collection], format)
}
