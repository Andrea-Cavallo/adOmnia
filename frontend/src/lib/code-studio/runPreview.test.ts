import { describe, expect, it } from 'vitest'
import { devServerPreviewRequest, hasWebAppToPreview } from './runPreview'
import type { LivePreviewReport } from '../livepreview-api'

const report = { targets: [{ kind: 'node', relative: 'web', devScript: 'dev' }] } as unknown as LivePreviewReport
const config = { kind: 'command', workingDirectory: './web', programArguments: ['run', 'dev'] }

describe('devServerPreviewRequest', () => {
  it('maps the dev script of a Node app to a dev-server preview', () => {
    expect(devServerPreviewRequest(config, report)).toEqual({ mode: 'devserver', dir: 'web', script: 'dev' })
  })
  it('ignores build/test scripts, other folders and non-command kinds', () => {
    expect(devServerPreviewRequest({ ...config, programArguments: ['run', 'build'] }, report)).toBeNull()
    expect(devServerPreviewRequest({ ...config, workingDirectory: 'api' }, report)).toBeNull()
    expect(devServerPreviewRequest({ ...config, kind: 'package' }, report)).toBeNull()
    expect(devServerPreviewRequest(config, null)).toBeNull()
  })
})

describe('hasWebAppToPreview', () => {
  const reportOf = (...targets: object[]) => ({ targets }) as unknown as LivePreviewReport
  it('accepts static sites and Node apps with a known tool or framework', () => {
    expect(hasWebAppToPreview(reportOf({ kind: 'static', entryHtml: 'index.html' }))).toBe(true)
    expect(hasWebAppToPreview(reportOf({ kind: 'node', tool: 'vite' }))).toBe(true)
    expect(hasWebAppToPreview(reportOf({ kind: 'node', framework: 'react' }))).toBe(true)
  })
  it('rejects a plain Node script and a missing report', () => {
    expect(hasWebAppToPreview(reportOf({ kind: 'node', tool: '', framework: '', devScript: 'start' }))).toBe(false)
    expect(hasWebAppToPreview(null)).toBe(false)
  })
})
