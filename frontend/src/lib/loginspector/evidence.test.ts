import { describe, expect, it } from 'vitest'
import { buildEvidenceBundle, evidenceMarkdown, serializeEvidence } from './evidence'
import { EMPTY_FILTERS } from './query'
import { parseLogText } from './parse'

describe('shareable evidence package', () => {
  it('keeps a message with a backslash before a pipe inside its table cell', () => {
    const event = parseLogText(JSON.stringify({ timestamp: '2026-09-10T08:00:00Z', message: String.raw`C:\logs|tail` })).events[0]
    expect(evidenceMarkdown([event], 'run', '')).toContain(String.raw`C:\\logs\|tail`)
  })


  it('redacts raw, nested JSON and generated notes while distinguishing UI-hidden fields', () => {
    const secret = 'super-secret-value'
    const event = parseLogText(JSON.stringify({
      timestamp: '2026-09-10T08:00:00Z', message: `authorization: Bearer ${secret}`,
      request: { body: { password: secret, safe: 'visible' } },
    })).events[0]
    const bundle = buildEvidenceBundle([event], {
      filters: EMPTY_FILTERS,
      notes: `token=${secret}`,
      hiddenFields: ['request.body.debug'],
    })
    const serialized = serializeEvidence(bundle)
    expect(serialized).not.toContain(secret)
    expect(serialized).toContain('[redacted]')
    expect(bundle.redaction).toMatchObject({ uiHiddenFields: ['request.body.debug'], uiHiddenFieldsRemoved: false })
    expect(bundle.summaryMarkdown).toContain('Timeline')
  })
})
