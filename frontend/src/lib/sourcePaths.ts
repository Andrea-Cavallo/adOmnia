// Absolute paths reported by running code (stack frames, OpenTelemetry code.filepath) mapped
// back to a file of an open Go Studio project.

/** Project-relative path when the file lives under one of the open project roots. */
export function relativeToRoots(file: string, roots: readonly { id: string; root: string }[]): { sessionId: string; relativePath: string } | null {
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
  const target = normalize(file)
  for (const { id, root } of roots) {
    const base = normalize(root)
    if (!base) continue
    const caseInsensitive = /^[a-z]:\//i.test(base)
    const [a, b] = caseInsensitive ? [target.toLowerCase(), base.toLowerCase()] : [target, base]
    if (a.startsWith(`${b}/`)) return { sessionId: id, relativePath: target.slice(base.length + 1) }
  }
  return null
}
