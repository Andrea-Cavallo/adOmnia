import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('cross-platform Log Inspector interaction contract', () => {
  it('keeps keyboard access, responsive detail mode and bounded resize handles wired', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/loginspector/LogInspectorPanel.tsx'), 'utf8')
    const resize = readFileSync(join(process.cwd(), 'src/components/ui/ResizeHandle.tsx'), 'utf8')
    const advanced = readFileSync(join(process.cwd(), 'src/components/loginspector/AdvancedAnalysisPanel.tsx'), 'utf8')

    expect(panel).toContain("if (keyEvent.key === 'Escape')")
    expect(panel).toContain("if (!keyEvent.ctrlKey && !keyEvent.metaKey) return")
    expect(panel).toContain("key === 'f'")
    expect(panel).toContain("key === 'e'")
    expect(panel).toContain('Math.min(760, Math.max(190')
    expect(panel).toContain("startResize('filters')")
    expect(panel).toContain("startResize('detail')")
    expect(panel).toContain('focusedDetail')
    expect(resize).toContain('role="separator"')
    expect(resize).toContain('aria-label={label}')
    expect(advanced).toContain('role="dialog"')
    expect(advanced).toContain('aria-modal="true"')
  })
})
