import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const globals = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8')
const chrome = readFileSync(resolve(process.cwd(), 'src/components/goide/goStudioChrome.css'), 'utf8')
const handle = readFileSync(resolve(process.cwd(), 'src/components/ui/ResizeHandle.tsx'), 'utf8')
const workspace = readFileSync(resolve(process.cwd(), 'src/components/goide/GoStudioWorkspace.tsx'), 'utf8')
const panel = readFileSync(resolve(process.cwd(), 'src/components/goide/GoStudioPanel.tsx'), 'utf8')

/**
 * GS-5: with the black skin the pane dividers were invisible, because every
 * hairline fell back to --color-border-1 (nearly the island background) and the
 * Go Studio splitters drew no line at rest at all. These are source contracts:
 * the visual regression cannot be asserted from a jsdom test.
 */
describe('Go Studio pane splitters (GS-5)', () => {
  it('uses a theme-derived divider token instead of a border color that vanishes in dark skins', () => {
    expect(globals).toContain('--color-divider:')
    expect(globals).toContain('--color-divider-hover:')
    expect(handle).toContain('var(--color-divider')
  })

  it('keeps the splitter line visible at rest and accent on hover, drag and focus', () => {
    expect(chrome).toContain('.go-studio-splitter')
    expect(chrome).toContain('width: 2px')
    expect(chrome).toContain('height: 2px')
    expect(chrome).toContain('.go-studio-splitter:hover::after')
    expect(chrome).toContain('.go-studio-splitter:active::after')
    expect(chrome).toContain('.go-studio-splitter:focus-visible::after')
  })

  it('gives the splitters a 10px hit area straddling the island border', () => {
    expect(handle).toContain('go-studio-splitter')
    expect(handle).toContain('w-[10px]')
    expect(handle).toContain('h-[10px]')
    expect(workspace).toContain('-right-2')
    expect(workspace).toContain('-left-2')
    expect(workspace).toContain('-top-2')
  })

  it('exposes orientation and resizes from the keyboard', () => {
    expect(handle).toContain('aria-orientation={orientation}')
    expect(handle).toContain('tabIndex={onArrow ? 0 : undefined}')
    expect(handle).toContain('ArrowRight')
    expect(handle).toContain('ArrowLeft')
    expect(handle).toContain('ArrowUp')
    expect(handle).toContain('ArrowDown')
  })

  it('resets the dragged pane to its default size on double click', () => {
    expect(handle).toContain('onDoubleClick')
    expect(panel).toContain('DEFAULT_PANE_SIZES[key]')
    expect(panel).toContain('clampPaneSize')
    // One clamp definition only: the loader and the drag handler share it.
    expect(panel).not.toContain('Math.min(max, Math.max(min')
  })
})
