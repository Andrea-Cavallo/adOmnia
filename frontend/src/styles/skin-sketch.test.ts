import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/skin-sketch.css'), 'utf8')
const editorSource = readFileSync(resolve(process.cwd(), 'src/components/ui/JsonEditor.tsx'), 'utf8')

describe('Sketch search highlighting', () => {
  it('renders Ctrl+F matches as a marker stroke instead of the default outlined box', () => {
    expect(stylesheet).toContain("mark[data-json-search-match='true']")
    expect(stylesheet).toContain("mark[data-json-search-active='true']")
    expect(stylesheet).toContain('176deg,')
    expect(stylesheet).toContain('outline: none !important')
    expect(stylesheet).toContain("textarea::selection")
    expect(editorSource).toContain('data-json-search-active')
  })
})
