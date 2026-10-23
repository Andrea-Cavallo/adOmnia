const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|[\\/])/

/** Senza gli slash finali: stessa semantica di `.replace(/\/+$/, '')` senza la regex quadratica. */
function withoutTrailingSlashes(path: string): string {
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end -= 1
  return path.slice(0, end)
}

/**
 * Risolve un percorso stampato da go build/run (es. "./main.go" o "../pkg/x.go")
 * rispetto alla working directory dell'esecuzione, restituendo un percorso assoluto con "/".
 */
export function resolveConsolePath(path: string, workingDirectory: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (ABSOLUTE_PATH.test(normalized) || !workingDirectory) return normalized
  const base = withoutTrailingSlashes(workingDirectory.replace(/\\/g, '/'))
  const drive = /^[A-Za-z]:/.exec(base)?.[0] ?? ''
  const segments = base.slice(drive.length).split('/').filter(Boolean)
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return `${drive}/${segments.join('/')}`
}
