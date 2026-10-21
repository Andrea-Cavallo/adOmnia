import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentSessionControls } from '@/lib/milk-api'
import { CodeStudioAgentSessionOptions } from './CodeStudioAgentSessionOptions'

describe('session choices', () => {
  it('renders advertised grouped models and boolean options, but not permission modes', () => {
    const controls = { root: '/project', images: true, controls: [
      { id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'opus-id', options: [{ name: 'Available', options: [{ value: 'opus-id', name: 'Opus' }, { value: 'sonnet-id', name: 'Sonnet' }] }] },
      { id: 'think', name: 'Thinking', type: 'boolean', currentValue: true },
      { id: 'mode', name: 'Bypass permissions', type: 'select', category: 'mode', currentValue: 'ask', options: [] },
    ] } as unknown as AgentSessionControls
    const html = renderToStaticMarkup(<CodeStudioAgentSessionOptions controls={controls} disabled onChange={async () => {}} />)
    expect(html).toContain('Opus')
    expect(html).toContain('Sonnet')
    expect(html).toContain('selected=""')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Thinking')
    expect(html).not.toContain('Bypass permissions')
  })
})
