import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8')
const globals = read('styles/globals.css')
const codeStudio = (name: string) => read(`components/code-studio/${name}`)

describe('design tokens used by Code Studio', () => {
  it('defines --color-danger in both theme blocks, as an alias of --color-error', () => {
    expect(globals.match(/--color-danger:\s*var\(--color-error\)/g)).toHaveLength(2)
  })

  it('does not hide an undefined token behind a hardcoded red fallback', () => {
    for (const name of ['codeStudioEditor.css', 'CodeStudioContextPanel.tsx', 'CodeStudioStatusBar.tsx']) {
      expect(codeStudio(name)).not.toContain('var(--color-danger, #')
    }
  })

  it('modal dialogs use the shared backdrop instead of a hardcoded black overlay', () => {
    for (const name of ['CodeStudioChangeSignatureDialog.tsx', 'CodeStudioMoveSymbolDialog.tsx']) {
      expect(codeStudio(name)).not.toMatch(/fixed inset-0[^"]*bg-black/)
    }
  })
})
