import type { Collection, TreeNode } from './types'

export interface NodeLocation { collectionId: string; nodeId: string }
export function locateNode(collections: Collection[], id: string): (NodeLocation & { node: TreeNode; parentId: string | null; index: number }) | null {
  const walk = (nodes: TreeNode[], collectionId: string, parentId: string | null): ReturnType<typeof locateNode> => {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]
      if (node.id === id) return { node, nodeId: id, collectionId, parentId, index }
      if (node.type === 'folder') { const found = walk(node.children, collectionId, node.id); if (found) return found }
    }
    return null
  }
  for (const collection of collections) { const found = walk(collection.children, collection.id, null); if (found) return found }
  return null
}

export function containsTreeNode(node: TreeNode, id: string): boolean {
  return node.id === id || (node.type === 'folder' && node.children.some(child => containsTreeNode(child, id)))
}

/** One immutable transaction: remove the sources together, then insert in visual order. */
export function moveCollectionNodes(collections: Collection[], sources: NodeLocation[], collectionId: string, parentId: string | null, index: number): Collection[] {
  const target = collections.find(c => c.id === collectionId)
  const parent = parentId ? locateNode(collections, parentId) : null
  if (!target || (parentId && (parent?.collectionId !== collectionId || parent.node.type !== 'folder'))) return collections
  const ids = new Map(sources.map(s => [s.nodeId, s.collectionId]))
  const selected: NonNullable<ReturnType<typeof locateNode>>[] = []
  const walk = (nodes: TreeNode[], owner: string, parent: string | null) => nodes.forEach((node, index) => {
    if (ids.get(node.id) === owner) selected.push({ node, nodeId: node.id, collectionId: owner, parentId: parent, index })
    else if (node.type === 'folder') walk(node.children, owner, node.id)
  })
  collections.forEach(c => walk(c.children, c.id, null))
  if (!selected.length || selected.some(s => parentId && containsTreeNode(s.node, parentId))) return collections
  const moving = new Set(selected.map(s => s.nodeId))
  const insertion = Math.max(0, index - selected.filter(s => s.collectionId === collectionId && s.parentId === parentId && s.index < index).length)
  const remove = (nodes: TreeNode[]): TreeNode[] => nodes.filter(n => !moving.has(n.id)).map(n => n.type === 'folder' ? { ...n, children: remove(n.children) } : n)
  const insert = (nodes: TreeNode[], currentParent: string | null): TreeNode[] => {
    if (currentParent === parentId) { const next = [...nodes]; next.splice(insertion, 0, ...selected.map(s => s.node)); return next }
    return nodes.map(n => n.type === 'folder' ? { ...n, children: insert(n.children, n.id) } : n)
  }
  const affected = new Set([...selected.map(s => s.collectionId), collectionId])
  return collections.map(c => !affected.has(c.id) ? c : { ...c, children: c.id === collectionId ? insert(remove(c.children), null) : remove(c.children) })
}

export const REQUEST_DRAG_TYPE = 'application/x-adomnia-requests'
