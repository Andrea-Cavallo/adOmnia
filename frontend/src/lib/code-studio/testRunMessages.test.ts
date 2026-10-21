import { describe, expect, it } from 'vitest'
import { emptyRunMessage } from './testRunMessages'

describe('emptyRunMessage', () => {
  it('says the run is starting while it is running', () => {
    expect(emptyRunMessage({ status: 'running' })).toContain('Building and starting')
  })

  it('distinguishes a stopped run from one with no matching test', () => {
    const stopped = emptyRunMessage({ status: 'stopped' })
    expect(stopped).toContain('stopped')
    expect(stopped).not.toContain('No test matches')
  })

  it('points at the output when the command failed before the results', () => {
    expect(emptyRunMessage({ status: 'failed', diagnostics: 'pytest: module not found' })).toContain('Output tab')
  })

  it('reports the filters when a finished run has no matching test', () => {
    expect(emptyRunMessage({ status: 'finished' })).toBe('No test matches the filters.')
  })
})
