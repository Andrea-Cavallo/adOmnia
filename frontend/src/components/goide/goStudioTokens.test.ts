import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = __dirname
const globals = readFileSync(join(here, '../../styles/globals.css'), 'utf8')

describe('design tokens used by Go Studio', () => {
  it('defines --color-danger in both theme blocks, as an alias of --color-error', () => {
    expect(globals.match(/--color-danger:\s*var\(--color-error\)/g)).toHaveLength(2)
  })

  it('does not hide an undefined token behind a hardcoded red fallback', () => {
    const offenders = readdirSync(here)
      .filter((name) => /\.(css|tsx)$/.test(name))
      .filter((name) => readFileSync(join(here, name), 'utf8').includes('var(--color-danger, #'))
    expect(offenders).toEqual([])
  })

  it('modal dialogs use the shared backdrop instead of a hardcoded black overlay', () => {
    for (const name of ['GoStudioChangeSignatureDialog.tsx', 'GoStudioMoveSymbolDialog.tsx']) {
      expect(readFileSync(join(here, name), 'utf8')).not.toMatch(/fixed inset-0[^"]*bg-black/)
    }
  })
})
