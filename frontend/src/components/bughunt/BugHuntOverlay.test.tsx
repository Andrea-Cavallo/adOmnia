import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { INITIAL_SNAPSHOT, type GameSnapshot } from './prototype'
import { BugHuntOverlay } from './BugHuntOverlay'

let snapshot: GameSnapshot = INITIAL_SNAPSHOT
// Exercise the actual menu branch with a completed stage; effects are not run by SSR.
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useState: (initial: unknown) => {
    let value = typeof initial === 'function' ? initial() : initial
    if (value && typeof value === 'object' && 'health' in value) value = snapshot
    if (value === true) value = false // intro has already been dismissed
    return [value, () => undefined]
  } }
})
vi.mock('@/stores/settings', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select({ settings: { appearance: { language: 'en' } } }) }))

it.each([0, 1])('offers the next environment after stage %i, rather than a pause menu', (level) => {
  snapshot = { ...INITIAL_SNAPSHOT, level, levelComplete: true }
  const html = renderToStaticMarkup(<BugHuntOverlay onClose={() => undefined} />)
  expect(html).toContain('Next environment:')
  expect(html).toContain(level === 0 ? 'API Gateway' : 'Production')
  expect(html).not.toContain('Restart campaign')
})
it('shows the score and replay after the final boss', () => {
  snapshot = { ...INITIAL_SNAPSHOT, level: 2, finished: true, score: 2400, bestCombo: 12 }
  const html = renderToStaticMarkup(<BugHuntOverlay onClose={() => undefined} />)
  expect(html).toContain('2400')
  expect(html).toContain('One more run')
  expect(html).not.toContain('Next environment:')
})
