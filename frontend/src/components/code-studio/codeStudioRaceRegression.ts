import type { RaceReport } from './codeStudioConcurrency'

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
  // Una goroutine per ogni accesso del report, avviate insieme: il corpo resta da scrivere (serve il servizio vero).
  const starts = report.accesses.map((access, index) => {
    const frame = access.frames[0]
    return `\tgo func() {\n\t\tdefer wg.Done()\n\t\t<-start\n\t\t// ${access.kind}: call ${frame?.func ?? 'the code'} here (access ${index + 1} of ${report.accesses.length})\n\t}()`
  }).join('\n')
  return `// Paste into a *_test.go file in the affected package, then fill in the calls and remove t.Skip.
// Run with: go test -race -run ^${testName}$ ./...
package yourpackage

import (
\t"sync"
\t"testing"
)

${evidence}
func ${testName}(t *testing.T) {
\tt.Skip("initialise the real dependencies and call the accesses above, then remove this line")

\tvar wg sync.WaitGroup
\tstart := make(chan struct{})
\twg.Add(${report.accesses.length})
${starts}
\tclose(start) // release every goroutine together so the accesses overlap
\twg.Wait()
}
`
}
