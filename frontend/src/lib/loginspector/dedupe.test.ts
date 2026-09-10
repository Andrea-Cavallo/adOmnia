import { describe, expect, it } from 'vitest'
import { parseLogSourcesInBackground } from './multiSource'
import { deduplicateAcquisitionEvents } from './dedupe'
import { fromText } from './sources'

describe('controlled acquisition deduplication', () => {
  it('folds repeated imports while preserving their provenance', async () => {
    const line = JSON.stringify({ timestamp: '2026-09-10T08:00:00Z', level: 'INFO', message: 'attempt', correlationId: 'c1' })
    const parsed = await parseLogSourcesInBackground([
      { ...fromText(line, 'first.log', 'file'), sourceId: 'first' },
      { ...fromText(line, 'overlap.log', 'file'), sourceId: 'overlap' },
    ])
    const result = deduplicateAcquisitionEvents(parsed.events)
    expect(result.duplicateCount).toBe(1)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].duplicateSources).toEqual([{ sourceId: 'overlap', sourceName: 'overlap.log', line: 1 }])
  })

  it('never collapses identical retry lines from the same source', async () => {
    const line = JSON.stringify({ timestamp: '2026-09-10T08:00:00Z', level: 'WARN', message: 'retry attempt' })
    const parsed = await parseLogSourcesInBackground([{ ...fromText(`${line}\n${line}`, 'app.log', 'file'), sourceId: 'app' }])
    const result = deduplicateAcquisitionEvents(parsed.events)
    expect(result.duplicateCount).toBe(0)
    expect(result.events).toHaveLength(2)
  })
})
