import { beforeEach, describe, expect, it } from 'vitest'
import { patchToolView, placeTool, toolContext, toolKey, useStudioTools } from './studioToolState'

beforeEach(() => useStudioTools.setState({ placements: {}, views: {}, maximized: null, detached: [] }))
describe('studio tools', () => {
  it('recognizes only supported native tool routes and safe session identifiers', () => {
    expect(toolContext('?window=studio-tool&session=session-1&tool=terminal')).toEqual({ session: 'session-1', tool: 'terminal', key: 'tool-session-1-terminal' })
    expect(toolContext('?window=panel&session=session-1&tool=terminal')).toBeNull()
    expect(toolContext('?window=studio-tool&session=../bad&tool=terminal')).toBeNull()
    expect(toolContext('?window=studio-tool&session=session-1&tool=settings')).toBeNull()
  })
  it('keeps drafts and filters independent between tools and projects', () => {
    patchToolView(toolKey('session-1', 'milk'), 'draft', 'unfinished prompt')
    patchToolView(toolKey('session-1', 'logs'), 'filter', 'ERROR')
    patchToolView(toolKey('session-2', 'milk'), 'draft', 'another project')
    placeTool(toolKey('session-1', 'milk'), 'left')
    useStudioTools.setState({ detached: [toolKey('session-1', 'milk')] })
    useStudioTools.setState({ detached: [] })
    expect(useStudioTools.getState().views).toEqual({
      'tool-session-1-milk': { draft: 'unfinished prompt' },
      'tool-session-1-logs': { filter: 'ERROR' },
      'tool-session-2-milk': { draft: 'another project' },
    })
    expect(useStudioTools.getState().placements['tool-session-1-milk']).toBe('left')
  })
})
