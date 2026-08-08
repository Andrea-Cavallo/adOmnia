import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkForUpdateMock = vi.hoisted(() => vi.fn())

vi.mock('@/wailsjs/go/main/App', () => ({
  CheckForUpdate: checkForUpdateMock,
}))

const currentRelease = {
  currentVersion: 'v1.0.0',
  latestVersion: 'v1.0.0',
  updateAvailable: false,
  releaseUrl: 'https://github.com/Andrea-Cavallo/adOmnia/releases/tag/v1.0.0',
  releaseNotes: '',
  publishedAt: '',
  isDev: false,
}

describe('manual update check', () => {
  beforeEach(() => {
    vi.resetModules()
    checkForUpdateMock.mockReset()
  })

  it('does not contact GitHub until the user explicitly starts a check', async () => {
    checkForUpdateMock.mockResolvedValue(currentRelease)
    const { runManualUpdateCheck } = await import('./manualUpdateCheck')

    expect(checkForUpdateMock).not.toHaveBeenCalled()

    await expect(runManualUpdateCheck()).resolves.toEqual({ kind: 'current' })
    expect(checkForUpdateMock).toHaveBeenCalledOnce()
  })

  it('returns the release link when a newer version is available', async () => {
    checkForUpdateMock.mockResolvedValue({
      ...currentRelease,
      latestVersion: 'v1.1.0',
      updateAvailable: true,
      releaseUrl: 'https://github.com/Andrea-Cavallo/adOmnia/releases/tag/v1.1.0',
    })
    const { runManualUpdateCheck } = await import('./manualUpdateCheck')

    await expect(runManualUpdateCheck()).resolves.toEqual({
      kind: 'available',
      version: 'v1.1.0',
      url: 'https://github.com/Andrea-Cavallo/adOmnia/releases/tag/v1.1.0',
    })
  })

  it('keeps network failures inside the manual control', async () => {
    checkForUpdateMock.mockRejectedValue(new Error('offline'))
    const { runManualUpdateCheck } = await import('./manualUpdateCheck')

    await expect(runManualUpdateCheck()).resolves.toEqual({ kind: 'error' })
  })
})
