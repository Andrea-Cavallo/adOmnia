import type { SchemaEntry } from '@/stores/schemas'

type JSONSchema = Record<string, unknown>

/**
 * Builds a registry map from SchemaEntry[] for fast $ref lookup.
 * Key format: "#/components/schemas/<name>"
 */
export function buildRefRegistry(entries: SchemaEntry[]): Map<string, JSONSchema> {
  const map = new Map<string, JSONSchema>()
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.schema) as JSONSchema
      map.set(`#/components/schemas/${entry.name}`, parsed)
    } catch {
      /* skip invalid schemas */
    }
  }
  return map
}

/**
 * Recursively resolves $ref references within a JSON Schema using the provided registry.
 * Stops recursion at maxDepth to prevent infinite loops from circular references.
 */
export function resolveRefs(schema: JSONSchema, registry: Map<string, JSONSchema>, depth = 0): JSONSchema {
  if (depth > 10) return schema

  const ref = schema['$ref']
  if (typeof ref === 'string') {
    const resolved = registry.get(ref)
    if (resolved) {
      return resolveRefs(resolved, registry, depth + 1)
    }
    return schema // unresolved ref — return as-is
  }

  const result: JSONSchema = {}
  for (const [key, value] of Object.entries(schema)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = resolveRefs(value as JSONSchema, registry, depth + 1)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? resolveRefs(item as JSONSchema, registry, depth + 1)
          : item,
      )
    } else {
      result[key] = value
    }
  }
  return result
}
