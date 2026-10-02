import { describe, expect, it } from 'vitest'
import type { GoIDEDiagnosticsReport } from '@/lib/goide-lsp-api'
import { precommitProblems } from './goStudioPrecommit'

const report = (relativePath: string, ...severities: number[]) => ({ uri: relativePath, path: relativePath, relativePath, diagnostics: severities.map((severity) => ({ severity })) }) as unknown as GoIDEDiagnosticsReport

describe('precommitProblems', () => {
  it('counts errors and warnings only in the files being committed', () => {
    expect(precommitProblems([report('b.go', 1, 2, 3), report('a.go', 2), report('skipped.go', 1), report('clean.go', 3, 4)], new Set(['a.go', 'b.go', 'clean.go'])))
      .toEqual({ errors: 1, warnings: 2, files: ['a.go', 'b.go'] })
  })
})
