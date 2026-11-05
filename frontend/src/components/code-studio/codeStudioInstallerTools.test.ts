import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/code-studio-api', () => ({ detectGoIDEGoTool: vi.fn(), installGoIDEGoModule: vi.fn() }))
vi.mock('@/lib/ide-servers-api', () => ({ languageServers: vi.fn(), previewServerInstall: vi.fn() }))
vi.mock('@/lib/strix-api', () => ({ strixInfo: vi.fn(), strixInstall: vi.fn(), strixInstallPlan: vi.fn(), strixStatus: vi.fn(), isStrixActive: vi.fn() }))
vi.mock('@/lib/code-studio-lsp-api', () => ({ requestRipgrepStatus: vi.fn(), installRipgrep: vi.fn() }))
vi.mock('@/stores/ideLanguageServers', () => ({ useIdeLanguageServersStore: { getState: () => ({ install: vi.fn() }) } }))
vi.mock('@/stores/codeStudioToolInstall', () => ({ beginToolInstall: vi.fn(), endToolInstall: vi.fn() }))

import { INSTALLER_GROUPS, INSTALLER_TOOLS, installProgress } from './codeStudioInstallerTools'

describe('installer catalog', () => {
  it('has unique ids and only known groups', () => {
    const ids = INSTALLER_TOOLS.map((tool) => tool.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = new Set(INSTALLER_GROUPS.map((group) => group.id))
    expect(INSTALLER_TOOLS.every((tool) => groups.has(tool.group))).toBe(true)
    expect(INSTALLER_GROUPS.every((group) => INSTALLER_TOOLS.some((tool) => tool.group === group.id))).toBe(true)
  })

  it('keeps ripgrep in the Tools group, not buried under Go tools', () => {
    const ripgrep = INSTALLER_TOOLS.find((tool) => tool.id === 'ripgrep')
    expect(ripgrep?.group).toBe('tools')
    expect(INSTALLER_GROUPS.find((group) => group.id === 'tools')?.label).toBe('Tools')
    expect(INSTALLER_TOOLS.filter((tool) => tool.group === 'goTools').every((tool) => tool.id !== 'ripgrep')).toBe(true)
  })

  it('pins every go tool to a go-installable module the backend accepts', () => {
    const module = /^[A-Za-z0-9][A-Za-z0-9._~/-]{2,199}@[A-Za-z0-9._+-]{1,64}$/
    for (const tool of INSTALLER_TOOLS) {
      if (tool.source.kind === 'module') expect(tool.source.module).toMatch(module)
    }
  })
})

describe('installProgress', () => {
  it('counts a queued tool as not done, and names the first still busy', () => {
    const busy = new Set(['b', 'c'])
    expect(installProgress(['a', 'b', 'c'], (id) => busy.has(id))).toEqual({ done: 1, total: 3, current: 'b' })
  })
  it('ends with nothing current, and shows no bar without a batch', () => {
    expect(installProgress(['a'], () => false)).toEqual({ done: 1, total: 1, current: undefined })
    expect(installProgress([], () => true)).toBeNull()
  })
})
