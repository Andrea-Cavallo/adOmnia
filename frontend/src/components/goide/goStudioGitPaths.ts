/** Convert a repository path to the project tree, for enclosing and nested repos. */
export function gitPathInProject(projectRoot: string, repoRoot: string, path: string): string | null {
  const clean = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const project = clean(projectRoot), repo = clean(repoRoot)
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
