import type { DbResult } from '../dbShared'
import type { BsonDoc } from './bson'

/** An updateMany document must use update operators only: a plain document would be a replace. */
export function validateUpdate(update: BsonDoc | null): BsonDoc {
  const keys = update ? Object.keys(update) : []
  if (!update || keys.length === 0) throw new Error('Update is empty: use e.g. { $set: { field: value } }')
  const plain = keys.filter((k) => !k.startsWith('$'))
  if (plain.length) throw new Error(`Update needs operators ($set, $unset, $inc…), found plain field "${plain[0]}"`)
  const empty = keys.filter((k) => {
    const v = update[k]
    return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0
  })
  if (empty.length) throw new Error(`${empty[0]} is empty`)
  return update
}

/** matched/modified from an updateMany result, deleted count (as modified) from deleteMany. */
export function extractAffected(result: DbResult): { matched: number; modified: number } {
  const row = (result.rows?.[0] ?? {}) as Record<string, unknown>
  const affected = Number(result.rowsAffected ?? 0) || 0
  return {
    matched: Number(row.matched ?? affected) || 0,
    modified: Number(row.modified ?? affected) || 0,
  }
}
