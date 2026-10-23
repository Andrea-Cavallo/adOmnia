const GO_LOCATION = /\.go:(\d+)(?::\d+)?/g

/** Inizio del percorso che finisce in `end`: segmenti di [\w.@+-] separati da `/` o `\`, uniti in una sola passata. */
function pathStart(line: string, end: number): number {
  let at = end
  while (at > 0 && /[\w.@+-]/.test(line[at - 1])) at -= 1
  while (at > 0 && /[\\/]/.test(line[at - 1])) {
    let segment = at - 1
    while (segment > 0 && /[\w.@+-]/.test(line[segment - 1])) segment -= 1
    if (segment === at - 1) break
    at = segment
  }
  return at
}

/** A pod path is mapped only to an exact or unique suffix in the selected project's file index. */
export function remoteLogLocations(line: string, paths: readonly string[]): Array<{ start: number; end: number; file: string; line: number }> {
  const out: Array<{ start: number; end: number; file: string; line: number }> = []
  for (const match of line.matchAll(GO_LOCATION)) {
    const end = match.index + match[0].length
    const start = pathStart(line, match.index)
    const raw = line.slice(start, end).replace(/:\d+(?::\d+)?$/, '').replace(/\\/g,'/').replace(/^\.\//,'')
    const exact = paths.filter(path => path === raw)
    const suffix = exact.length ? exact : paths.filter(path => raw.endsWith('/'+path))
    const matches = suffix.length ? suffix : paths.filter(path => path.endsWith('/'+raw) || path === raw)
    if (matches.length !== 1 || Number(match[1]) < 1) continue
    out.push({ start, end, file: matches[0], line: Number(match[1]) })
  }
  return out
}
