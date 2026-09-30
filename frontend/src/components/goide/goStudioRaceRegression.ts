import type { RaceReport } from './goStudioConcurrency'

function goIdentifier(value: string): string {
  const words = value.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  const identifier = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('')
  return identifier || 'ConcurrentAccess'
}

/**
 * A deliberately incomplete, local test starter. The race report supplies evidence, but only the
 * developer knows how to initialise the real service/dependencies without fabricating a test.
 */
export function raceRegressionTestStarter(report: RaceReport): string {
  const primary = report.accesses[0]?.frames[0]
  const testName = `TestRaceRegression${goIdentifier(primary?.func ?? 'ConcurrentAccess')}`
  const evidence = report.accesses.map((access) => {
    const frame = access.frames[0]
    return `// ${access.kind}: ${frame?.func ?? 'unknown'} (${frame?.path ?? 'unknown'}:${frame?.line ?? '?'})`
  }).join('\n')
  return `// Paste into a *_test.go file in the affected package, then replace the TODO with a real reproduction.
// Run with: go test -race -run ^${testName}$ ./...
package yourpackage

import "testing"

${evidence}
func ${testName}(t *testing.T) {
\tt.Skip("TODO: initialise the real dependencies and reproduce the two concurrent accesses above")

\t// TODO: start the concurrent operations from the race report.
\t// Keep this test deterministic; use channels or a WaitGroup to coordinate the overlap.
}
`
}
