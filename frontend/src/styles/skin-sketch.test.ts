import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/skin-sketch.css'), 'utf8')
const editorSource = readFileSync(resolve(process.cwd(), 'src/components/ui/JsonEditor.tsx'), 'utf8')
const collectionTreeSource = readFileSync(resolve(process.cwd(), 'src/components/collections/CollectionTree.tsx'), 'utf8')

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

describe('Sketch JSON editor', () => {
  it('keeps the ruled paper without a red notebook margin beside code', () => {
    expect(stylesheet).not.toContain("[data-skin='sketch'] [data-editor='json']::before")
    expect(stylesheet).toContain("[data-skin='sketch'] [data-editor='json'] {")
  })
})

describe('Sketch collection selection', () => {
  it('renders the active collection request as a marker stroke', () => {
    expect(collectionTreeSource).toContain('data-collection-request')
    expect(collectionTreeSource).toContain('data-request-active')
    expect(stylesheet).toContain("[data-collection-request][data-request-active='true']")
    expect(stylesheet).toContain('var(--sk-marker)')
  })
})
