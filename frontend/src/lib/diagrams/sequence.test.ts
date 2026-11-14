import { describe, expect, it } from 'vitest'
import { bandRgb, parseSequence, sequenceFromText } from './sequence'
import { DIAGRAM_TEMPLATES } from './templates'

const LOGIN = `sequenceDiagram
autonumber
actor U as User
participant API
U->>API: login
API->>API: check password
alt valid
  API-->>U: token
else wrong password
  API-->>U: 401
end`

describe('colored bands (rect)', () => {
  it('tints the band and colors the messages inside it, without taking a row', () => {
    const graph = sequenceFromText('A->>B: before\nrect rgb(63, 185, 107)\n  B-->>A: ok\nend\nA->>B: after')
    const band = graph.nodes.find((node) => node.data.shape === 'seq-band')!
    expect(band.data.style.fill).toBe('rgba(63, 185, 107, 0.1)')
    expect(graph.edges.map((edge) => edge.data?.color)).toEqual(['', 'rgb(63, 185, 107)', ''])
    expect(graph.edges.map((edge) => edge.sourceHandle)).toEqual(['R0', 'L1', 'R2'])
    expect(bandRgb('#3fb96b')).toEqual([63, 185, 107])
    expect(bandRgb('amber')).toEqual([212, 160, 58])
  })

  it('draws the saga sequence template with its four colors and the alt fragment', () => {
    const saga = DIAGRAM_TEMPLATES.find((template) => template.id === 'sequence-saga')!
    const graph = sequenceFromText(saga.sequence!)
    expect(graph.nodes.filter((node) => node.data.shape === 'seq-band')).toHaveLength(4)
    expect(graph.nodes.filter((node) => node.data.shape === 'seq-alt')).toHaveLength(1)
    expect(new Set(graph.edges.map((edge) => edge.data?.color).filter(Boolean)).size).toBe(4)
  })
})

describe('sequence diagrams', () => {
  it('parses participants, message kinds and fragments', () => {
    const spec = parseSequence(LOGIN)
    expect(spec.participants.map((participant) => [participant.key, participant.label, participant.actor])).toEqual([['U', 'User', true], ['API', 'API', false]])
    expect(spec.steps.filter((step) => step.type === 'message').map((step) => step.type === 'message' && [step.kind, step.label])).toEqual([
      ['sync', '1. login'], ['sync', '2. check password'], ['reply', '3. token'], ['reply', '4. 401'],
    ])
  })

  it('attaches every message to the same row on both lifelines and frames the alt', () => {
    const graph = sequenceFromText(LOGIN)
    const lifelines = graph.nodes.filter((node) => node.data.shape.startsWith('seq-') && !node.parentId && node.data.shape !== 'seq-alt')
    expect(lifelines).toHaveLength(2)
    const [login, self, token] = graph.edges
    expect([login.sourceHandle, login.targetHandle]).toEqual(['R0', 'L0'])
    expect([self.sourceHandle, self.targetHandle, self.data?.routing]).toEqual(['R1', 'R2', 'orthogonal'])
    expect([token.sourceHandle, token.targetHandle, token.data?.dashed]).toEqual(['L4', 'R4', true])
    const alt = graph.nodes.find((node) => node.data.shape === 'seq-alt')!
    expect(alt.data.subtitle).toBe('[valid]')
    expect(alt.data.dividers).toHaveLength(1)
    // Activation bars belong to their lifeline, after it in the list.
    const bars = graph.nodes.filter((node) => node.data.shape === 'seq-activation')
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) expect(graph.nodes.findIndex((node) => node.id === bar.parentId)).toBeLessThan(graph.nodes.indexOf(bar))
  })
})
