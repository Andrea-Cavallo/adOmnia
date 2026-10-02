import { describe, expect, it } from 'vitest'
import type { GoIDEToolchainSettings } from '@/lib/goide-api'
import { goStudioSettingsReport, redactSetting, type GoStudioSettingsReportInput } from './goStudioSettingsExport'

const input: GoStudioSettingsReportInput = {
  projectName: 'billing',
  trusted: true,
  toolchain: {
    global: { goBinary: '', environment: { GOPROXY: 'https://user:s3cret@proxy.corp/go', GITHUB_TOKEN: 'ghp_x' } },
    project: { goBinary: 'C:/go/bin/go.exe', environment: { GOPROXY: 'off', GOTOOLCHAIN: 'local', GOSUMDB: 'off' } },
  } as unknown as GoIDEToolchainSettings,
  ai: { enabled: true, provider: 'openai', model: 'gpt', baseURL: 'https://k:v@llm.corp', apiKey: 'sk-live', credentialMode: 'environment', modelUpdatePolicy: 'manual', gatewayEnabled: false, gatewayPort: 0, workspaceActionsEnabled: false } as GoStudioSettingsReportInput['ai'],
  linter: { kind: 'golangci-lint', available: true, configPath: '/repo/.golangci.yml' },
  exportedAt: '2026-10-02T12:00:00Z',
}

describe('settings report', () => {
  it('never contains secrets and summarises the network mode', () => {
    const text = goStudioSettingsReport(input)
    for (const secret of ['s3cret', 'ghp_x', 'sk-live', 'k:v@', '/repo/']) expect(text).not.toContain(secret)
    const report = JSON.parse(text)
    expect(report.toolchain.global.environment).toEqual({ GITHUB_TOKEN: '[redacted]', GOPROXY: 'https://***@proxy.corp/go' })
    expect(report.toolchain.project.networkMode).toBe('airgapped')
    expect(report.toolchain.effective).toBe('project')
    expect(report.ai).toMatchObject({ apiKeyStored: true, baseURL: 'https://***@llm.corp', credentialMode: 'environment' })
    expect(report.linter).toEqual({ kind: 'golangci-lint', available: true, projectConfig: true })
  })
  it('redacts by name and URL credentials', () => {
    expect(redactSetting('NPM_AUTH', 'abc')).toBe('[redacted]')
    expect(redactSetting('GOPRIVATE', 'git.corp/*')).toBe('git.corp/*')
  })
})
