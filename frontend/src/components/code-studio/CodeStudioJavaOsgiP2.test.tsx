import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/code-studio-api', () => ({ subscribeGoIDEEvents: () => () => undefined, previewJavaOsgiP2: vi.fn(), downloadJavaOsgiP2: vi.fn(), cancelJavaOsgiP2: vi.fn() }))
vi.mock('@/lib/confirmDialog', () => ({ confirm: vi.fn() }))
vi.mock('@/stores/codeStudioToast', () => ({ studioToast: vi.fn() }))

import { CodeStudioJavaOsgiP2, p2ConfirmMessage, p2ResultMessage } from './CodeStudioJavaOsgiP2'

describe('CodeStudioJavaOsgiP2', () => {
  it('names every repository before the download is confirmed', () => {
    const message = p2ConfirmMessage({ targetPath: '/ws/kepler.target', locations: 2, units: 3, repositories: ['https://download.eclipse.org/releases/kepler/', 'file:///mirror'], downloaded: false, bundles: 0 })
    expect(message).toContain('3 unit(s) of 2 p2 location(s)')
    expect(message).toContain('• https://download.eclipse.org/releases/kepler/')
    expect(message).toContain('• file:///mirror')
    expect(message).toContain('checksums')
  })

  it('summarizes downloads, cache hits and problems', () => {
    expect(p2ResultMessage({ bundles: 70, downloaded: 68, reused: 2, problems: [] })).toBe('70 p2 bundle(s) ready: 68 downloaded, 2 already cached.')
    expect(p2ResultMessage({ bundles: 1, downloaded: 1, reused: 0, problems: ['dep: checksum'] })).toContain('1 problem(s) listed below')
  })

  it('stays hidden for a folder target', () => {
    expect(renderToStaticMarkup(<CodeStudioJavaOsgiP2 sessionId="s1" targetPath="/opt/kepler/plugins" onDownloaded={vi.fn()} />)).toBe('')
  })
})
