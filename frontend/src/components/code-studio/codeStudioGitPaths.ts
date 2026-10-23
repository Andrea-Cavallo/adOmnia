/** Separatori `/` e nessuna `/` finale: scansionato a mano, un `\/+$` riscansa la coda a ogni posizione. */
function cleanPath(value: string): string {
  const slashed = value.replace(/\\/g, '/')
  let end = slashed.length
  while (end > 0 && slashed[end - 1] === '/') end -= 1
  return slashed.slice(0, end)
}

/** Convert a repository path to the project tree, for enclosing and nested repos. */
export function gitPathInProject(projectRoot: string, repoRoot: string, path: string): string | null {
  const project = cleanPath(projectRoot), repo = cleanPath(repoRoot)
  const insensitive = /^[A-Za-z]:\//.test(project) || project.startsWith('//')
  const compare = (value: string) => insensitive ? value.toLowerCase() : value
  const p = compare(project), r = compare(repo)
  if (p === r) return path
  if (r.startsWith(`${p}/`)) return `${repo.slice(project.length + 1)}/${path}`
  if (p.startsWith(`${r}/`)) {
    const prefix = `${project.slice(repo.length + 1)}/`
    return compare(path).startsWith(compare(prefix)) ? path.slice(prefix.length) : null
  }
  return null
}

/** Path assoluto → path relativo al repository, per i pathspec di `git -C <repo>`. */
export function gitPathFromAbsolute(repoRoot: string, absolutePath: string): string {
  const repo = cleanPath(repoRoot)
  const path = cleanPath(absolutePath)
  const insensitive = /^[A-Za-z]:\//.test(repo) || repo.startsWith('//')
  const compare = (value: string) => insensitive ? value.toLowerCase() : value
  return compare(path).startsWith(`${compare(repo)}/`) ? path.slice(repo.length + 1) : path
}
