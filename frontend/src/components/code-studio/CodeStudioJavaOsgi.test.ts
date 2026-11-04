import { describe, expect, it } from 'vitest'
import { buildOutcomeMessage } from './CodeStudioJavaOsgi'

describe('buildOutcomeMessage', () => {
  it('sends compile errors to Problems and keeps the problems that have no file', () => {
    expect(buildOutcomeMessage({ done: 2, total: 2, stopped: false, errors: 3, problems: [] })).toBe('3 compile error(s) in 2 bundle(s): see Problems')
    expect(buildOutcomeMessage({ done: 2, total: 2, stopped: false, errors: 0, problems: ['app: New.class is too new', 'other'] })).toBe('2 bundle(s) compiled. app: New.class is too new (+1 more)')
  })

  it('says where a stopped build stopped', () => {
    expect(buildOutcomeMessage({ done: 1, total: 4, stopped: true, errors: 0, problems: [] })).toBe('Build stopped after 1 of 4 bundle(s)')
  })
})
