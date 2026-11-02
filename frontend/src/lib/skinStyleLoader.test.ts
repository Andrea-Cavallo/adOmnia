import { describe, expect, it, vi } from 'vitest'
vi.mock('@/styles/skin-terminal-green.css', () => ({}))
vi.mock('@/styles/skin-static-citrine.css', () => ({}))
vi.mock('@/styles/skin-sketch.css', () => ({}))
vi.mock('@fontsource/architects-daughter/400.css', () => ({}))
vi.mock('@fontsource/monaspace-radon/400.css', () => ({}))
import { loadSkinStyles } from './skinStyleLoader'

describe('optional skin styles', () => {
  it('needs no bundle for the default or an unknown custom skin', async () => {
    await expect(loadSkinStyles()).resolves.toBeUndefined()
    await expect(loadSkinStyles('custom-user-skin')).resolves.toBeUndefined()
    await expect(loadSkinStyles('toString')).resolves.toBeUndefined()
    await expect(loadSkinStyles('__proto__')).resolves.toBeUndefined()
  })
  it('loads selected styles once and supports switching skins', async () => {
    const first = loadSkinStyles('sketch')
    expect(loadSkinStyles('sketch')).toBe(first)
    await first
    await loadSkinStyles('terminal-green')
    await loadSkinStyles('static-citrine')
    expect(loadSkinStyles('sketch')).toBe(first)
  })
})
