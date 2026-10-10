import { describe, expect, it } from 'vitest'
import { compareCollections } from './merge'
import type { Collection } from '@/lib/types'

describe('collaboration explicit merge', () => {
  it('ignores prototype keys from incoming data', () => {
    const incoming=JSON.parse('{"id":"remote","name":"API","children":[],"__proto__":{"polluted":true},"constructor":{"evil":true}}')
    const plan=compareCollections({id:'local',name:'API',children:[]},incoming)
    expect(plan.changes).toEqual([])
    const result=plan.apply(new Set(['$/__proto__','$/constructor']))
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect((result as unknown as {polluted?:boolean}).polluted).toBeUndefined()
  })
  const local: Collection = { id: 'local', name: 'API', children: [{ id: 'folder', type: 'folder', name: 'Payments', children: [] }] }
  it('keeps local values until individually selected and preserves identity', () => {
    const plan = compareCollections(local, { ...local, id: 'remote', name: 'Renamed' })
    expect(plan.changes).toEqual([{ path: '$/name', local: 'API', incoming: 'Renamed', conflict: true }])
    expect(plan.apply(new Set())).toEqual(local)
    expect(plan.apply(new Set(['$/name']))).toEqual({ ...local, name: 'Renamed' })
  })
  it('does not delete locally present folders when remote lacks them', () => {
    expect(compareCollections(local, { ...local, children: [] }).apply(new Set())).toEqual(local)
  })
  it('matches regenerated folder IDs and previews nested additions', () => {
    const incoming: Collection = { ...local, children: [{ id: 'new-folder', type: 'folder', name: 'Payments', children: [{ id: 'child', type: 'folder', name: 'New', children: [] }] }] }
    const plan = compareCollections(local, incoming)
    expect(plan.changes).toHaveLength(1)
    const merged = plan.apply(new Set(plan.changes.map(c => c.path)))
    expect(merged.children[0].id).toBe('folder')
    expect(merged.children[0].type === 'folder' && merged.children[0].children).toHaveLength(1)
    expect(local.children[0].type === 'folder' && local.children[0].children).toHaveLength(0)
  })
  it('treats duplicate names as a conflict instead of guessing a match', () => {
    const duplicated = { ...local, children: [...local.children, { ...local.children[0], id: 'second' }] }
    const plan = compareCollections(duplicated, local)
    expect(plan.changes[0].conflict).toBe(true)
    expect(plan.apply(new Set())).toEqual(duplicated)
  })
})
