import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/components/layout/Rail.css'), 'utf8')
const source = readFileSync(resolve(process.cwd(), 'src/components/layout/Rail.tsx'), 'utf8')

describe('compact application rail', () => {
  it('stays narrow and keeps flyouts above the workspace sidebar', () => {
    expect(stylesheet).toMatch(/\.adomnia-rail\s*\{[^}]*z-index:\s*40;[^}]*width:\s*48px;/s)
    expect(stylesheet).not.toContain('isolation: isolate')
    expect(stylesheet).toMatch(/\.adomnia-rail__flyout\s*\{[^}]*z-index:\s*80;/s)
    expect(source).toContain('adomnia-rail__flyout absolute left-full')
  })

  it('uses transparent icon controls and an icon-height active marker', () => {
    expect(stylesheet).toMatch(/\.adomnia-rail__category-main\s*\{[^}]*width:\s*40px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s)
    expect(stylesheet).toMatch(/\.adomnia-rail__category\[data-active='true'\]::before[\s\S]*?height:\s*22px;/)
    expect(stylesheet).not.toContain('width: 54px')
  })
})
