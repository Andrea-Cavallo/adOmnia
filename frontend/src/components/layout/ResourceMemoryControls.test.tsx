import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '../../../bindings/adomnia/internal/resources/models'
import { GOPLS_MEMORY_PRESETS, ResourceMemoryControls } from './ResourceMemoryControls'

const emptySnapshot = { runtime: { memoryLimit: 0 }, processes: [] } as unknown as Snapshot

describe('gopls memory presets', () => {
  // Il default (0) ripristina i 768 MiB di avvio; 512 è la scelta esplicita per macchine
  // con poca RAM. I valori sono quelli misurati in docs/performance/typing-2026-10-24.md.
  it('offers the startup default and the measured RAM-saving preset', () => {
    expect(GOPLS_MEMORY_PRESETS.map((preset) => preset.mib)).toEqual([0, 512])
  })

  it('renders both presets and states the measured cost of the lower limit', () => {
    const html = renderToStaticMarkup(<ResourceMemoryControls sample={emptySnapshot} />)
    expect(html).toContain('Default (768 MiB)')
    expect(html).toContain('RAM saving (512 MiB)')
    expect(html).toContain('512 MiB saves about 220 MiB of RAM')
  })
})
