import { describe, expect, it } from 'vitest'
import { projectProfile } from './projectProfile'

const root = 'C:\work\shop'
const names = { typescript: 'TypeScript / JavaScript', html: 'HTML' }
const unit = (language: string, kind: string, folder = '') => ({ language, kind, root: folder ? `${root}\${folder}` : root, name: '', manifest: '' })

describe('projectProfile', () => {
  it('keeps the Go summary for Go projects', () => {
    const profile = projectProfile({ rootPath: root, units: [{ ...unit('go', 'module'), manifest: `${root}\go.mod` }] }, names)
    expect(profile).toMatchObject({ hasGo: true, primaryLanguage: 'go', summary: '1 module · go.mod' })
  })

  it('describes a Node app without mentioning Go', () => {
    const profile = projectProfile({ rootPath: root, units: [unit('typescript', 'node')] }, names)
    expect(profile).toMatchObject({ hasGo: false, primaryLanguage: 'typescript', summary: '1 TypeScript / JavaScript app' })
  })

  it('counts several units of the same kind and mixes languages', () => {
    const profile = projectProfile({ rootPath: root, units: [unit('go', 'module', 'orders'), unit('typescript', 'node', 'web'), unit('typescript', 'node', 'admin'), unit('html', 'static', 'docs')] }, names)
    expect(profile.summary).toBe('1 module · folder mode · 2 TypeScript / JavaScript apps · 1 HTML site')
  })

  it('falls back to folder mode when nothing is recognised', () => {
    expect(projectProfile({ rootPath: root, units: [] })).toEqual({ hasGo: false, primaryLanguage: null, summary: '0 modules · folder mode' })
  })
})
