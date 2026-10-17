const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|[\\/])/

/**
 * Risolve un percorso stampato da go build/run (es. "./main.go" o "../pkg/x.go")
 * rispetto alla working directory dell'esecuzione, restituendo un percorso assoluto con "/".
 */
export function resolveConsolePath(path: string, workingDirectory: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (ABSOLUTE_PATH.test(normalized) || !workingDirectory) return normalized
  const base = workingDirectory.replace(/\\/g, '/').replace(/\/+$/, '')
  const drive = /^[A-Za-z]:/.exec(base)?.[0] ?? ''
  const segments = base.slice(drive.length).split('/').filter(Boolean)
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return `${drive}/${segments.join('/')}`
}
