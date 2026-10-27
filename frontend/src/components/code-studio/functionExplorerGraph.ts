import type { GoIDEHierarchyItem } from '@/lib/code-studio-lsp-api'
import { layoutLayered, type LayeredLink } from '@/lib/layeredGraph'

export const hierarchyKey = (item: GoIDEHierarchyItem) =>
  `${item.location.uri}:${item.location.range.startLine}:${item.location.range.startColumn}`
export type CallDirection = 'incoming' | 'outgoing'
export type ExpandCalls = (
  direction: CallDirection,
  item: GoIDEHierarchyItem,
) => Promise<GoIDEHierarchyItem[]>

/** Each side expands away from the root. A shared identity closes recursion without losing edges. */
export async function functionGraph(
  root: GoIDEHierarchyItem,
  depth: number,
  expand: ExpandCalls,
  cancelled: () => boolean = () => false,
) {
  const items = new Map([[hierarchyKey(root), root]])
  const links = new Map<string, LayeredLink>()
  let limited = false
  let requests = 0
  for (const direction of ['incoming', 'outgoing'] as const) {
    let frontier = [root]
    const visited = new Set<string>()
    for (
      let level = 0;
      level < Math.min(3, Math.max(1, depth)) && !cancelled();
      level++
    ) {
      const next: GoIDEHierarchyItem[] = []
      for (const parent of frontier) {
        const parentKey = hierarchyKey(parent)
        if (visited.has(parentKey) || cancelled()) continue
        if (requests >= 120) {
          limited = true
          break
        }
        requests++
        visited.add(parentKey)
        for (const child of await expand(direction, parent)) {
          const childKey = hierarchyKey(child)
          if (!items.has(childKey) && items.size >= 120) {
            limited = true
            continue
          }
          items.set(childKey, child)
          const from = direction === 'incoming' ? childKey : parentKey
          const to = direction === 'incoming' ? parentKey : childKey
          const edgeKey = `${from}>${to}`
          if (links.size >= 240 && !links.has(edgeKey)) {
            limited = true
            continue
          }
          links.set(edgeKey, { from, to, value: 1 })
          if (!visited.has(childKey)) next.push(child)
        }
      }
      frontier = next
    }
  }
  return {
    layout: layoutLayered(
      [...items].map(([id, data]) => ({ id, data, weight: 1 })),
      [...links.values()],
    ),
    limited,
  }
}
