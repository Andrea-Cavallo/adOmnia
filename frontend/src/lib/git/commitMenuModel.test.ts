import { describe, expect, it } from 'vitest'
import { buildCommitMenu, type CommitMenuContext, type MenuActionNode } from './commitMenuModel'
import type { CommitMeta, RepoState } from './types'

function meta(overrides: Partial<CommitMeta> = {}): CommitMeta {
  return {
    hash: 'abc1234',
    fullHash: 'abc1234def5678',
    parents: ['parent00'],
    isMerge: false,
    isHead: false,
    onCurrentBranch: false,
    published: false,
    branches: [],
    tags: [],
    remoteURL: '',
    subject: 'do a thing',
    body: '',
    author: 'Andrea',
    authorEmail: 'a@example.com',
    date: '2026-06-19',
    ...overrides,
  }
}

function state(overrides: Partial<RepoState> = {}): RepoState {
  return {
    branch: 'feature', head: 'abc1234def5678', detached: false, dirty: false,
    published: false, protected: false, operation: '', conflictedFiles: [],
    aheadCount: 0, behindCount: 0, ...overrides,
  }
}

function ctx(overrides: Partial<CommitMenuContext> = {}): CommitMenuContext {
  return { meta: meta(), state: state(), selectedCount: 1, hasRemote: true, ...overrides }
}

/** Find a node by id anywhere in the tree (including submenus). */
function find(nodes: MenuActionNode[], id: string): MenuActionNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.submenu) {
      const hit = find(n.submenu, id)
      if (hit) return hit
    }
  }
  return undefined
}

describe('buildCommitMenu', () => {
  it('returns the multi-select menu when several commits are selected', () => {
    const menu = buildCommitMenu(ctx({ selectedCount: 3 }))
    expect(find(menu, 'multi.cherryPick')).toBeTruthy()
    expect(find(menu, 'multi.squash')).toBeTruthy()
    // Single-only actions must not appear.
    expect(find(menu, 'cherryPick')).toBeUndefined()
    expect(find(menu, 'reset')).toBeUndefined()
  })

  it('returns nothing without commit metadata', () => {
    expect(buildCommitMenu(ctx({ meta: null }))).toEqual([])
  })

  it('disables checkout / reset / compare-HEAD for the HEAD commit', () => {
    const menu = buildCommitMenu(ctx({ meta: meta({ isHead: true, onCurrentBranch: true }) }))
    expect(find(menu, 'checkout')?.disabled).toBe(true)
    expect(find(menu, 'reset')?.disabled).toBe(true)
    expect(find(menu, 'compare.head')?.disabled).toBe(true)
  })

  it('exposes local-HEAD rewrite actions only for an unpublished HEAD commit', () => {
    const local = buildCommitMenu(ctx({ meta: meta({ isHead: true, published: false }) }))
    expect(find(local, 'head.amend')).toBeTruthy()
    expect(find(local, 'head.undo')).toBeTruthy()

    const published = buildCommitMenu(ctx({ meta: meta({ isHead: true, published: true }) }))
    expect(find(published, 'head.amend')).toBeUndefined()
  })

  it('adds merge-specific actions and relabels revert for merge commits', () => {
    const menu = buildCommitMenu(ctx({ meta: meta({ isMerge: true, parents: ['p1', 'p2'] }) }))
    expect(find(menu, 'merge.compareP2')).toBeTruthy()
    expect(find(menu, 'revert')?.label.toLowerCase()).toContain('merge')
  })

  it('disables remote-only actions when there is no compatible remote', () => {
    const menu = buildCommitMenu(ctx({ hasRemote: false }))
    expect(find(menu, 'copy.remoteUrl')?.disabled).toBe(true)
    expect(find(menu, 'more.openRemote')?.disabled).toBe(true)
    expect(find(menu, 'danger.forcePush')?.disabled).toBe(true)
  })

  it('disables cherry-pick and rebase-onto for commits already on the current branch', () => {
    const menu = buildCommitMenu(ctx({ meta: meta({ onCurrentBranch: true }) }))
    expect(find(menu, 'cherryPick')?.disabled).toBe(true)
    expect(find(menu, 'rebase.onto')?.disabled).toBe(true)
  })

  it('disables previous-compare and squash for a root commit with no parent', () => {
    const menu = buildCommitMenu(ctx({ meta: meta({ isHead: true, published: false, parents: [] }) }))
    expect(find(menu, 'compare.previous')?.disabled).toBe(true)
    expect(find(menu, 'head.squashPrev')?.disabled).toBe(true)
  })

  it('keeps the hard reset flagged as a danger action', () => {
    const menu = buildCommitMenu(ctx())
    expect(find(menu, 'reset.hard')?.danger).toBe(true)
    expect(find(menu, 'danger')?.danger).toBe(true)
  })
})
