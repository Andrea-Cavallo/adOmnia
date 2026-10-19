import type { GoIDESession } from '@/lib/code-studio-api'

export interface MavenBuildUnit {
  root: string
  manifest: string
  name: string
  kind: string
}

/** Unità Maven e Gradle del progetto: gli stessi file che le lens dell'editor già analizzano. */
export function mavenBuildUnits(project: GoIDESession['project']): MavenBuildUnit[] {
  return (project.units ?? [])
    .filter((unit) => unit.language === 'java' && !!unit.manifest && (unit.kind === 'maven' || unit.kind === 'gradle'))
    .map((unit) => ({ root: unit.root, manifest: unit.manifest ?? '', name: unit.name || unit.root.split(/[\\/]/).pop() || unit.root, kind: unit.kind }))
}
