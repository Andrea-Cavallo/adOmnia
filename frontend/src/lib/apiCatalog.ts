import type { Collection, RequestItem, TreeNode } from '@/lib/types'
import type { ApiCatalogRequest } from '@/lib/flowMermaid'

export function flattenApiCatalog(collections: Collection[]): ApiCatalogRequest[] {
  const walk = (collection: Collection, nodes: TreeNode[], path: string[]): ApiCatalogRequest[] => nodes.flatMap((node) => {
    if (node.type === 'folder') return walk(collection, node.children, [...path, node.name])
    return [{
      id: `${collection.id}:${node.id}`,
      label: [...path, node.name].join(' / '),
      source: collection.name,
      request: node as RequestItem,
    }]
  })

  return collections.flatMap((collection) => walk(collection, collection.children, []))
}
