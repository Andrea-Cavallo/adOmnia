import { describe, expect, it } from 'vitest'
import source from './MockPanel.tsx?raw'

describe('MockPanel', () => {
  it('does not expose the inactive REST presets action', () => {
    expect(source).not.toMatch(/REST presets/i)
    expect(source).not.toContain('loadRestPresets')
  })

  it('uses an explicit collection import instead of merging every collection automatically', () => {
    expect(source).toContain('Import endpoints')
    expect(source).toContain('importCollectionEndpoints')
    expect(source).not.toContain('collections.flatMap((collection) => collectRestEndpoints(collection.children))')
  })

  it('provides the control-room navigation views', () => {
    expect(source).toContain('Endpoint explorer')
    expect(source).toContain('Contract mode is coming next')
    expect(source).toContain("type MockView = 'overview' | 'endpoints' | 'traffic' | 'contract'")
  })

  it('consumes a focused Mock-this-tab handoff instead of showing every endpoint', () => {
    expect(source).toContain("sessionStorage.getItem('adomnia.mock.focus')")
    expect(source).toContain('Focused request scope')
    expect(source).toContain('Show all endpoints')
  })

  it('uses the editable syntax-highlighted JSON editor for static mock bodies', () => {
    expect(source).toContain("import { JsonEditor } from '@/components/ui/JsonEditor'")
    expect(source).toContain('Editable JSON response')
    expect(source).toContain('Format JSON')
    expect(source).not.toContain('rows={Math.min(12, Math.max(3, resp.body.split')
  })
})
