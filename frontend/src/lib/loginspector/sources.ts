import { readFileSmart } from '@/lib/fileUtils'

/**
 * Input acquisition sits behind this seam so every ingest path — clipboard,
 * editor, drop, file picker and, later, `oc logs` — reaches the parser the
 * same way.
 */
export type LogSourceKind = 'paste' | 'editor' | 'file' | 'sample' | 'oc'

export interface LogSourceResult {
  text: string
  /** Human label shown in the toolbar (file name, sample name, `oc logs …`). */
  name: string
  kind: LogSourceKind
  bytes: number
}

/**
 * The picker accepts anything on purpose: the format is decided by reading the
 * content, never by the extension. A pod log dumped as `pod-2026-03-11` or
 * `out.dat` must open exactly like a `.log`.
 */
export const ACCEPTED_EXTENSIONS = '*'

/** Extensions we advertise in the drop zone — a hint, not a restriction. */
export const COMMON_EXTENSIONS = '.log .txt .json .jsonl .ndjson .out'

export function fromText(text: string, name: string, kind: LogSourceKind): LogSourceResult {
  return { text, name, kind, bytes: new Blob([text]).size }
}

const NUL = String.fromCharCode(0)

/**
 * NUL bytes in the head of the file mean it is not text. Decoding it anyway
 * would fill the list with mojibake, so refuse with a clear reason instead.
 */
export function looksBinary(text: string): boolean {
  return text.slice(0, 4096).includes(NUL)
}

export async function loadFromFile(file: File): Promise<LogSourceResult> {
  const { text } = await readFileSmart(file)
  if (looksBinary(text)) {
    throw new Error(`"${file.name}" looks like a binary file, not a text log.`)
  }
  return { text, name: file.name, kind: 'file', bytes: file.size }
}

/**
 * `oc logs` streaming is architecturally prepared but not implemented: it needs
 * a Go binding that shells out to the OpenShift CLI. Until that lands the UI
 * shows this source as unavailable rather than pretending to work.
 */
export interface OcLogsRequest {
  namespace: string
  pod: string
  container?: string
  follow?: boolean
  tailLines?: number
}

export const OC_LOGS_SOURCE = {
  kind: 'oc' as const,
  label: 'oc logs',
  available: false,
  reason: 'Requires the OpenShift CLI binding — planned, not implemented yet.',
  load(_request: OcLogsRequest): Promise<LogSourceResult> {
    return Promise.reject(new Error(OC_LOGS_SOURCE.reason))
  },
}
