import { describe, expect, it } from 'vitest'
import { EMPTY_MONGO_QUERY } from './MongoQueryBar'
import { describeQuery, entriesFor, recordQuery, toggleFavorite } from './queryHistory'

const q = (filter: string) => ({ ...EMPTY_MONGO_QUERY, filter })

describe('mongo query history', () => {
  it('skips the default query and dedupes identical runs to the top', () => {
    let h = recordQuery([], 'shop', 'orders', EMPTY_MONGO_QUERY, 1)
    expect(h).toHaveLength(0)
    h = recordQuery(h, 'shop', 'orders', q('{ a: 1 }'), 1)
    h = recordQuery(h, 'shop', 'orders', q('{ b: 1 }'), 2)
    h = recordQuery(h, 'shop', 'orders', q(' { a: 1 } '), 3)
    expect(h.map((e) => e.query.filter.trim())).toEqual(['{ a: 1 }', '{ b: 1 }'])
  })

  it('caps recents per collection but keeps favorites', () => {
    let h = recordQuery([], 'shop', 'orders', q('{ fav: 1 }'), 0)
    h = toggleFavorite(h, h[0].id, 'Mine')
    for (let i = 1; i <= 40; i += 1) h = recordQuery(h, 'shop', 'orders', q(`{ n: ${i} }`), i)
    h = recordQuery(h, 'shop', 'users', q('{ other: 1 }'), 50)
    const { favorites, recent } = entriesFor(h, 'shop', 'orders')
    expect(favorites.map((e) => e.name)).toEqual(['Mine'])
    expect(recent).toHaveLength(30)
    expect(recent[0].query.filter).toBe('{ n: 40 }')
    expect(entriesFor(h, 'shop', 'users').recent).toHaveLength(1)
  })

  it('describes only the parts that are set', () => {
    expect(describeQuery({ ...EMPTY_MONGO_QUERY, filter: '{ a: 1 }', sort: '{ _id: -1 }' })).toBe('{ a: 1 } · sort { _id: -1 }')
  })
})
