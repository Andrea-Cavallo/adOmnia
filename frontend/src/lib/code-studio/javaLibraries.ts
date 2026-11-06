import type { JavaLibrary } from '@/lib/code-studio-api'

/** `group:artifact:version`, l'identità di una libreria Maven nell'albero. */
export const libraryCoordinate = (library: Pick<JavaLibrary, 'groupId' | 'artifactId' | 'version'>) => `${library.groupId}:${library.artifactId}:${library.version}`

function normalized(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * La libreria di un file aperto dai sorgenti estratti (`…/maven-sources/<group>/<artifact>/<version>/…`) e il
 * file relativo alla sua radice: l'albero apre la libreria fin lì.
 */
export function libraryOfSourcesPath(path: string, libraries: JavaLibrary[]): { library: JavaLibrary; file: string } | null {
  const target = normalized(path)
  const folded = target.toLowerCase()
  for (const library of libraries) {
    const marker = `/maven-sources/${library.groupId}/${library.artifactId}/${library.version}/`.toLowerCase()
    const index = folded.indexOf(marker)
    if (index >= 0) return { library, file: target.slice(index + marker.length) }
  }
  return null
}

/** La libreria `group:artifact`: quella del modulo indicato se il progetto ne usa più versioni, altrimenti la prima. */
export function findLibrary(libraries: JavaLibrary[], groupId: string, artifactId: string, module?: string): JavaLibrary | null {
  const matches = libraries.filter((library) => library.groupId === groupId && library.artifactId === artifactId)
  return matches.find((library) => module !== undefined && library.modules.includes(module)) ?? matches[0] ?? null
}

/** La `<dependency>` (o `<parent>`, `<plugin>`) che contiene la riga, 1-based: groupId e artifactId scritti nel blocco. */
export function dependencyBlockAt(text: string, line: number): { groupId: string; artifactId: string } | null {
  const lines = text.split(/\r?\n/)
  if (line < 1 || line > lines.length) return null
  const opening = /<(dependency|parent|plugin)>/
  let start = -1
  let tag = ''
  for (let index = line - 1; index >= 0; index -= 1) {
    if (index < line - 1 && /<\/(dependency|parent|plugin)>/.test(lines[index])) return null
    const found = opening.exec(lines[index])
    if (found) { start = index; tag = found[1]; break }
  }
  if (start < 0) return null
  const closing = `</${tag}>`
  const end = lines.findIndex((value, index) => index >= line - 1 && value.includes(closing))
  if (end < 0) return null
  const block = lines.slice(start, end + 1).join('\n')
  const groupId = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(block)?.[1] ?? (tag === 'plugin' ? 'org.apache.maven.plugins' : '')
  const artifactId = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(block)?.[1] ?? ''
  return groupId && artifactId ? { groupId, artifactId } : null
}

/** Il nome corto nell'albero: l'artifactId; il gruppo resta nel tooltip e accanto, attenuato. */
export function shortGroup(groupId: string): string {
  const parts = groupId.split('.')
  return parts.length > 2 ? parts.slice(-2).join('.') : groupId
}
