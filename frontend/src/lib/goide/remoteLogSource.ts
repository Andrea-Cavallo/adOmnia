/** A pod path is mapped only to an exact or unique suffix in the selected project's file index. */
export function remoteLogLocations(line: string, paths: readonly string[]): Array<{ start: number; end: number; file: string; line: number }> {
 const out: Array<{ start: number; end: number; file: string; line: number }> = []
 for (const match of line.matchAll(/(?:[A-Za-z]:[\\/])?(?:[\w.@+-]+[\\/])*[\w.@+-]+\.go:(\d+)(?::\d+)?/g)) {
  const raw = match[0].replace(/:\d+(?::\d+)?$/, '').replace(/\\/g,'/').replace(/^\.\//,'')
  const exact = paths.filter(path => path === raw)
  const suffix = exact.length ? exact : paths.filter(path => raw.endsWith('/'+path))
  const matches = suffix.length ? suffix : paths.filter(path => path.endsWith('/'+raw) || path === raw)
  if (matches.length !== 1 || Number(match[1]) < 1) continue
  out.push({ start: match.index!, end: match.index!+match[0].length, file: matches[0], line: Number(match[1]) })
 }
 return out
}
