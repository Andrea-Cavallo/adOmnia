import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/code-studio-api', () => ({ detectGoIDEGoTool: vi.fn(), installGoIDEGoModule: vi.fn() }))
vi.mock('@/lib/ide-servers-api', () => ({ languageServers: vi.fn(), previewServerInstall: vi.fn() }))
vi.mock('@/lib/strix-api', () => ({ strixInfo: vi.fn(), strixInstall: vi.fn(), strixInstallPlan: vi.fn(), strixStatus: vi.fn(), isStrixActive: vi.fn() }))
vi.mock('@/stores/ideLanguageServers', () => ({ useIdeLanguageServersStore: { getState: () => ({ install: vi.fn() }) } }))
vi.mock('@/stores/codeStudioToolInstall', () => ({ beginToolInstall: vi.fn(), endToolInstall: vi.fn() }))

import { INSTALLER_GROUPS, INSTALLER_TOOLS } from './codeStudioInstallerTools'

describe('installer catalog', () => {
  it('has unique ids and only known groups', () => {
    const ids = INSTALLER_TOOLS.map((tool) => tool.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = new Set(INSTALLER_GROUPS.map((group) => group.id))
    expect(INSTALLER_TOOLS.every((tool) => groups.has(tool.group))).toBe(true)
    expect(INSTALLER_GROUPS.every((group) => INSTALLER_TOOLS.some((tool) => tool.group === group.id))).toBe(true)
  })

  it('pins every go tool to a go-installable module the backend accepts', () => {
    const module = /^[A-Za-z0-9][A-Za-z0-9._~/-]{2,199}@[A-Za-z0-9._+-]{1,64}$/
    for (const tool of INSTALLER_TOOLS) {
      if (tool.source.kind === 'module') expect(tool.source.module).toMatch(module)
    }
  })
})
