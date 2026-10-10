import type { GoIDEGoroutine } from '@/lib/goide-debug-api'
import { waitResources } from '@/components/goide/goStudioConcurrency'

/** Include the creator and the current project frame; do not mix unrelated
 * goroutines from the same file or a previously paused debugger. */
export function goroutinesForLine(goroutines: readonly GoIDEGoroutine[], file: string, line: number) {
  return goroutines.filter(g => [g.origin, g.location].some(site => site?.relativePath === file && site.line === line))
}
export function waitsForLine(goroutines: readonly GoIDEGoroutine[], file: string, line: number) {
  const selected = new Set(goroutinesForLine(goroutines, file, line).map(g => g.id))
  return waitResources([...goroutines]).filter(resource => resource.goroutines.some(g => selected.has(g.id)))
}
export function isErrorLine(text: string): boolean {
  return /\b(?:err\w*|panic|recover)\b|errors\.(?:Is|As|Unwrap|Join)|fmt\.Errorf/i.test(text)
}
