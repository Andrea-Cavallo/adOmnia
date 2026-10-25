import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/components/layout/WelcomePanel.css'), 'utf8')

describe('Hub palette', () => {
  it('takes every text tone from the primary (accent) palette', () => {
    // The redesign left the Hub on --color-text-1/3, so changing the primary
    // palette no longer recoloured the headline, navigation or recent files.
    expect(css).toContain('--hub-ink: var(--color-accent);')
    expect(css).toContain('--hub-muted: var(--color-accent-muted, var(--color-text-3));')
  })

  it('does not pin the Hub text back to the neutral text tokens', () => {
    expect(css).not.toContain('--hub-ink: var(--color-text-1);')
    expect(css).not.toContain('--hub-muted: var(--color-text-3);')
  })
})
