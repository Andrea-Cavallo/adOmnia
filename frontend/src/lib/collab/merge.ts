import type { Collection, TreeNode } from '@/lib/types'

export interface MergeChange {
  path: string
  local: unknown
  incoming: unknown
  conflict: boolean
}

export interface CollectionMergePlan {
  changes: MergeChange[]
  apply: (selected: ReadonlySet<string>) => Collection
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const identity = (node: TreeNode) => `${node.type}:${node.name}`

/** Two-way comparison: differing existing values always require an explicit choice.
 * Remote absence never deletes local work. Ambiguous names are whole-list conflicts.
 * IDs are local identities and are never overwritten by an incoming match.
 */
export function compareCollections(local: Collection, incoming: Collection): CollectionMergePlan {
  const changes: MergeChange[] = []
  function fields(a: Record<string, unknown>, b: Record<string, unknown>, path: string, selected?: ReadonlySet<string>): Record<string, unknown> {
    const result = { ...a }
    for (const [key, value] of Object.entries(b)) {
      if (key === 'id' || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      const field = `${path}/${encodeURIComponent(key)}`
      if (key === 'children' && Array.isArray(a[key]) && Array.isArray(value)) {
        result[key] = nodes(a[key] as TreeNode[], value as TreeNode[], field, selected)
      } else if (!same(a[key], value)) {
        if (!selected) changes.push({ path: field, local: a[key], incoming: value, conflict: a[key] !== undefined })
        else if (selected.has(field)) result[key] = value
      }
    }
    return result
  }
  function nodes(a: TreeNode[], b: TreeNode[], path: string, selected?: ReadonlySet<string>): TreeNode[] {
    const keys = [...a, ...b].map(identity)
    const ambiguous = keys.some(key => a.filter(n => identity(n) === key).length > 1 || b.filter(n => identity(n) === key).length > 1)
    if (ambiguous) {
      if (!same(a, b) && !selected) changes.push({ path, local: a, incoming: b, conflict: true })
      return selected?.has(path) ? b : a
    }
    const result = [...a]
    for (const node of b) {
      const index = a.findIndex(n => n.id === node.id || identity(n) === identity(node))
      const field = `${path}/${encodeURIComponent(identity(node))}`
      if (index < 0) {
        if (!selected) changes.push({ path: field, local: undefined, incoming: node, conflict: false })
        else if (selected.has(field)) result.push(node)
      } else {
        result[index] = fields(a[index] as unknown as Record<string, unknown>, node as unknown as Record<string, unknown>, field, selected) as unknown as TreeNode
      }
    }
    return result
  }
  fields(local as unknown as Record<string, unknown>, incoming as unknown as Record<string, unknown>, '$')
  return { changes, apply: selected => fields(local as unknown as Record<string, unknown>, incoming as unknown as Record<string, unknown>, '$', selected) as unknown as Collection }
}
