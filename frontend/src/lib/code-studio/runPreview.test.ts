import { describe, expect, it } from 'vitest'
import { devServerPreviewRequest } from './runPreview'
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
