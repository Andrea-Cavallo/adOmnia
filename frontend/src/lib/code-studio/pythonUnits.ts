import type { GoIDESession } from '@/lib/code-studio-api'

/** Unità Python del progetto, con la cartella relativa usata dal servizio per identificarla. */
export interface PythonBuildUnit {
  /** Cartella dell'unità relativa alla radice del progetto ("." per la radice). */
  unit: string
  root: string
  name: string
  kind: string
}

/** Unità Python rilevate dall'adapter: manifest Python e cartella dell'unità. */
export function pythonUnits(project: GoIDESession['project']): PythonBuildUnit[] {
  const root = (project.realPath ?? project.rootPath ?? '').replace(/\\/g, '/').replace(/\/$/, '')
  return (project.units ?? [])
    .filter((unit) => unit.language === 'python' && !!unit.root)
    .map((unit) => {
      const absolute = unit.root.replace(/\\/g, '/').replace(/\/$/, '')
      const relative = root && absolute.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? absolute.slice(root.length + 1) : absolute
      return { unit: relative || '.', root: unit.root, name: unit.name || absolute.split('/').pop() || absolute, kind: unit.kind }
    })
}
