import { describe, expect, it, vi } from 'vitest'
import { functionGraph, hierarchyKey } from './functionExplorerGraph'
import type { GoIDEHierarchyItem } from '@/lib/code-studio-lsp-api'
const item = (name: string) =>
  ({
    name,
    token: name,
    location: {
      uri: `file:///${name}.go`,
      range: { startLine: 1, startColumn: 1 },
    },
  }) as GoIDEHierarchyItem
describe('Function Explorer graph', () => {
  it('keeps callers above the current function and callees below it', async () => {
    const root = item('Save'),
      caller = item('Handler'),
      callee = item('Insert')
    const result = await functionGraph(root, 1, async (direction) =>
      direction === 'incoming' ? [caller] : [callee],
    )
    const nodes = result.layout.nodes
    expect(nodes.find((n) => n.id === hierarchyKey(caller))!.y).toBeLessThan(
      nodes.find((n) => n.id === hierarchyKey(root))!.y,
    )
    expect(nodes.find((n) => n.id === hierarchyKey(callee))!.y).toBeGreaterThan(
      nodes.find((n) => n.id === hierarchyKey(root))!.y,
    )
  })
  it('bounds recursion and keeps the cycle instead of repeatedly expanding it', async () => {
    const a = item('A'),
      b = item('B')
    const expand = vi.fn(async () => [a, b])
    const result = await functionGraph(a, 3, expand)
    expect(result.layout.nodes).toHaveLength(2)
    expect(expand.mock.calls.length).toBeLessThanOrEqual(4)
  })
  it('limits graphs and stops work after cancellation', async () => {
    const result = await functionGraph(item('A'), 3, async () =>
      Array.from({ length: 200 }, (_, i) => item(`B${i}`)),
    )
    expect(result.layout.nodes).toHaveLength(120)
    expect(result.limited).toBe(true)
    const expand = vi.fn(async () => [])
    await functionGraph(item('A'), 3, expand, () => true)
    expect(expand).not.toHaveBeenCalled()
  })
})
