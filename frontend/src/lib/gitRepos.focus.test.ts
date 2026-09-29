import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GIT_FOCUS_REPO_EVENT, focusRepo, loadLastRepo, loadRepos } from './gitRepos'

const values = new Map<string, string>()
const events = new EventTarget()

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  vi.stubGlobal('window', events)
})

describe('focusRepo (Go Studio → Git Studio)', () => {
  it('adds the repository, makes it the last one and notifies an open Git Studio', () => {
    const seen: string[] = []
    const listener = (event: Event) => seen.push((event as CustomEvent<string>).detail)
    events.addEventListener(GIT_FOCUS_REPO_EVENT, listener)
    focusRepo('C:/work/shop')
    events.removeEventListener(GIT_FOCUS_REPO_EVENT, listener)
    expect(loadLastRepo()).toBe('C:/work/shop')
    expect(loadRepos().map((repo) => repo.path)).toEqual(['C:/work/shop'])
    expect(seen).toEqual(['C:/work/shop'])
  })

  it('reuses a repository already saved with different case or trailing separator on Windows', () => {
    focusRepo('C:/Work/Shop/')
    expect(focusRepo('c:/work/shop')).toBe('C:/Work/Shop/')
    expect(loadRepos()).toHaveLength(1)
  })

  it('keeps POSIX paths case-sensitive', () => {
    focusRepo('/home/dev/Shop')
    focusRepo('/home/dev/shop')
    expect(loadRepos()).toHaveLength(2)
  })

  it('ignores an empty path', () => {
    expect(focusRepo('  ')).toBe('')
    expect(loadRepos()).toHaveLength(0)
  })
})
