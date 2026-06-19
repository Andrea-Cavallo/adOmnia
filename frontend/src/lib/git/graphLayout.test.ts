import { describe, expect, it } from 'vitest'
import { buildGitGraphLayout } from './graphLayout'
import type { CommitInfo } from './types'

function commit(hash: string, parents: string[]): CommitInfo {
  return {
    hash,
    fullHash: `${hash}0000000`,
    parents,
    author: 'Andrea',
    date: '2026-06-19',
    message: hash,
    decorations: [],
  }
}

describe('buildGitGraphLayout', () => {
  it('keeps merge parents on stable lanes and reconnects the side branch', () => {
    const layout = buildGitGraphLayout([
      commit('merge01', ['main001', 'side001']),
      commit('main001', ['base001']),
      commit('side001', ['base001']),
      commit('base001', []),
    ])

    expect(layout.laneCount).toBe(2)
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 1, 0])
    expect(layout.rows[0].parents.map((edge) => edge.toLane)).toEqual([0, 1])
    expect(layout.rows[1].continuations.map((line) => line.lane)).toContain(1)
    expect(layout.rows[2].parents).toContainEqual(expect.objectContaining({ fromLane: 1, toLane: 0 }))
  })

  it('matches abbreviated parent hashes to full commit hashes', () => {
    const layout = buildGitGraphLayout([
      commit('child01', ['parent0']),
      { ...commit('parent0', []), fullHash: 'parent0000000000000000000000000000000000' },
    ])

    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0])
    expect(layout.rows[1].incoming).toBe(true)
  })

  it('expands the graph width only when additional lanes are active', () => {
    const linear = buildGitGraphLayout([commit('one0001', ['two0002']), commit('two0002', [])])
    const merge = buildGitGraphLayout([
      commit('merge01', ['main001', 'side001']),
      commit('main001', ['base001']),
      commit('side001', ['base001']),
      commit('base001', []),
    ])

    expect(linear.width).toBeLessThan(merge.width)
  })
})
