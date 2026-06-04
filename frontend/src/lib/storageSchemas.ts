export interface StorageSchemaDefinition {
  bucket: string
  item: string
  currentVersion: number
  legacyKeys?: string[]
}

export const STORAGE_SCHEMAS = {
  collections: {
    bucket: 'collections',
    item: 'all',
    currentVersion: 2,
  },
  flows: {
    bucket: 'flows',
    item: 'all',
    currentVersion: 3,
    legacyKeys: ['adomnia.flows.v1'],
  },
} as const satisfies Record<string, StorageSchemaDefinition>

export type StorageSchemaName = keyof typeof STORAGE_SCHEMAS

export function storageSchema(name: StorageSchemaName): StorageSchemaDefinition {
  return STORAGE_SCHEMAS[name]
}

export function versionedEnvelope<T>(
  schema: StorageSchemaDefinition,
  dataKey: string,
  data: T,
): Record<string, unknown> {
  return { version: schema.currentVersion, [dataKey]: data }
}
