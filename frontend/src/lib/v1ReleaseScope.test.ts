import { describe, expect, it } from 'vitest'
import { isFeatureVisible } from './featureRegistry'
import { routeGlobalDropFile } from './globalFileRouter'

describe('v1 release discovery', () => {
  const stable = { showAdvancedFeatures: true, showLabFeatures: false }
  const experimental = { ...stable, showLabFeatures: true }
  it('keeps deferred tools out of discovery even with lab tools enabled', () => {
    for (const id of ['pdfeditor','latex','kube','plugins'] as const) {
      expect(isFeatureVisible(id, stable)).toBe(false)
      expect(isFeatureVisible(id, experimental)).toBe(false)
    }
    for (const id of ['database','broker','goide','collections','soap','grpc','gitsync'] as const) expect(isFeatureVisible(id, stable)).toBe(true)
    expect(isFeatureVisible('collab', stable)).toBe(false)
    expect(isFeatureVisible('collab', experimental)).toBe(true)
  })
  it('preserves PDF file opening and original bytes despite the discovery gate', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nfile payload')
    const file = { name: 'Guide.PDF', arrayBuffer: async () => bytes.buffer } as File
    const result = await routeGlobalDropFile(file)
    expect(result.kind).toBe('pdf')
    if (result.kind === 'pdf') expect(result.bytes).toEqual(bytes)
  })
})
