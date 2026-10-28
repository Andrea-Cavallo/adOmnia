interface OriginUnit {
  language: string
  kind: string
  root: string
  name?: string
}
interface OriginProject {
  rootPath: string
  units?: OriginUnit[]
}
const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '')
const inside = (path: string, root: string) => {
  if (/^[a-z]:/i.test(root)) {
    path = path.toLowerCase()
    root = root.toLowerCase()
  }
  return path === root || path.startsWith(`${root}/`)
}

/** Uses workspace metadata rather than guessing an import path from a folder name. */
export function symbolOrigin(
  project: OriginProject,
  path: string,
  language: string,
  source: string,
): string | null {
  const file = norm(path),
    dir = file.slice(0, file.lastIndexOf('/'))
  if (language === 'go') {
    const unit = (project.units ?? [])
      .filter(
        (unit) =>
          unit.language === 'go' &&
          unit.kind === 'module' &&
          unit.name &&
          inside(file, norm(unit.root)),
      )
      .sort((a, b) => b.root.length - a.root.length)[0]
    return unit ? `${unit.name}${dir.slice(norm(unit.root).length)}` : null
  }
  if (language === 'java') {
    const clean = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
    return (
      /^\s*package\s+([\w$]+(?:\s*\.\s*[\w$]+)*)\s*;/m
        .exec(clean)?.[1]
        .replace(/\s/g, '') ?? '(default package)'
    )
  }
  if (
    ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(
      language,
    )
  ) {
    const root = norm(project.rootPath)
    return inside(file, root) ? file.slice(root.length + 1) : null
  }
  return null
}
