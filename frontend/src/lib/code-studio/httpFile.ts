const REQUEST_LINE = /^(GET|QUERY|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+/i
const SEPARATOR = /^[ \t]*###/

export interface HttpFileRequest {
  /** 1-based line of the `METHOD url` line, where the editor shows its lens. */
  line: number
  method: string
  /** The request block, `###` separators excluded: what the .http importer reads. */
  text: string
}

/** The requests of a `.http` / `.rest` file, one per `###` block, in file order. */
export function httpFileRequests(source: string): HttpFileRequest[] {
  const lines = source.split(/\r?\n/)
  const requests: HttpFileRequest[] = []
  let start = 0
  const flush = (end: number) => {
    const offset = lines.slice(start, end).findIndex((line) => REQUEST_LINE.test(line.trim()))
    if (offset >= 0) {
      const line = start + offset
      requests.push({ line: line + 1, method: lines[line].trim().split(/\s+/)[0].toUpperCase(), text: lines.slice(start, end).join('\n') })
    }
  }
  lines.forEach((line, index) => {
    if (!SEPARATOR.test(line)) return
    flush(index)
    start = index + 1
  })
  flush(lines.length)
  return requests
}
