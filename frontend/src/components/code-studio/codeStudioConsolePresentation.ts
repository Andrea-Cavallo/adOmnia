import type { ConsoleParsedLine } from './codeStudioConsoleLines'

/** Sequence zero is the store's synthetic execution header, not program output. */
export function consoleOutputLines(lines: ConsoleParsedLine[]): ConsoleParsedLine[] {
  return lines.filter(line => line.stream !== 'system' || (line.sequence !== 0 && line.text.trim() !== ''))
}
