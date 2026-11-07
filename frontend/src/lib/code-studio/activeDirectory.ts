/**
 * Directory that owns an editor file, relative to the project root.
 * `''` is the root itself; `null` means no active file.
 */
export function activeDirectoryOf(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return ''
  const cut = normalized.lastIndexOf('/')
  return cut < 0 ? '' : normalized.slice(0, cut)
}

/** Whether a tree row is the active directory or one of its ancestors. */
export function isActiveDirectoryTrail(row: string, activeDirectory: string | null): boolean {
  if (activeDirectory === null || activeDirectory === '') return false
  return row === activeDirectory || activeDirectory.startsWith(`${row}/`)
}
