import type { GoIDEExecution } from '@/lib/code-studio-api'
import { parseConsoleLines, type ConsoleChunk } from './codeStudioConsoleLines'

export function createRunLogSnapshot(execution: GoIDEExecution, chunks: readonly ConsoleChunk[]) {
  const captured = chunks.map(chunk => ({ ...chunk }))
  const lines = parseConsoleLines(captured)
  const events = lines.map(line => ({
    message: line.text, stream: line.stream, sequence: line.sequence, runId: execution.id,
  }))
  return {
    name: `run-${execution.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    json: JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), execution, chunks: captured, events }, null, 2),
    txt: lines.map(line => line.text).join('\n') + (captured[captured.length - 1]?.text.endsWith('\n') ? '\n' : ''),
    inspector: events.map(event => JSON.stringify(event)).join('\n'),
  }
}
