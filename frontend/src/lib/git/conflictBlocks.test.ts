import { describe, expect, it } from 'vitest'
import { findConflictBlocks, resolveConflictBlock } from './conflictBlocks'

const merged = [
  'package main',
  '<<<<<<< HEAD',
  'a := 1',
  '=======',
  'a := 2',
  '>>>>>>> feature',
  'mid',
  '<<<<<<< HEAD',
  'b := 1',
  '||||||| base',
  'b := 0',
  '=======',
  'b := 2',
  '>>>>>>> feature',
  'end',
].join('\n')

describe('conflict blocks', () => {
  it('finds two-way and diff3 blocks with labels', () => {
    const blocks = findConflictBlocks(merged)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ start: 1, end: 5, ours: ['a := 1'], base: null, theirs: ['a := 2'], oursLabel: 'HEAD', theirsLabel: 'feature' })
    expect(blocks[1]).toMatchObject({ ours: ['b := 1'], base: ['b := 0'], theirs: ['b := 2'] })
  })

  it('resolves one block at a time', () => {
    const first = resolveConflictBlock(merged, 0, 'theirs')
    expect(first.split('\n').slice(0, 3)).toEqual(['package main', 'a := 2', 'mid'])
    expect(findConflictBlocks(first)).toHaveLength(1)
    const done = resolveConflictBlock(first, 0, 'both')
    expect(done).toBe('package main\na := 2\nmid\nb := 1\nb := 2\nend')
    expect(resolveConflictBlock(merged, 1, 'base')).toContain('mid\nb := 0\nend')
  })

  it('keeps CRLF and ignores unterminated markers', () => {
    const crlf = 'x\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> b\r\ny'
    expect(resolveConflictBlock(crlf, 0, 'ours')).toBe('x\r\nours\r\ny')
    expect(findConflictBlocks('<<<<<<< HEAD\nonly ours\n')).toEqual([])
    expect(resolveConflictBlock('no conflicts', 0, 'ours')).toBe('no conflicts')
  })
})
