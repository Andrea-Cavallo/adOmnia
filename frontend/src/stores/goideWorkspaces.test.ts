import { describe, expect, it } from 'vitest'
import type { GoIDESession } from '@/lib/goide-api'
import { sessionsInWorkspace } from './goide'

function session(id: string, workspaceId?: string): GoIDESession {
  return { id, workspaceId, project: { name: id } } as unknown as GoIDESession
}

describe('sessionsInWorkspace', () => {
  it('keeps Go Studio workspaces apart and puts legacy sessions in the default one', () => {
    const sessions = [session('a'), session('b', 'default'), session('c', 'workspace-1')]
    expect(sessionsInWorkspace(sessions, 'default').map((item) => item.id)).toEqual(['a', 'b'])
    expect(sessionsInWorkspace(sessions, 'workspace-1').map((item) => item.id)).toEqual(['c'])
    expect(sessionsInWorkspace(sessions, 'workspace-2')).toEqual([])
  })
})
