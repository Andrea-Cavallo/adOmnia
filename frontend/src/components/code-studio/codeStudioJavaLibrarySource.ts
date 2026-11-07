/**
 * Il codice di una libreria Maven: dal jar dei sorgenti nel repository locale, estratto in sola lettura. Se il
 * jar non c'è propone il download con il comando esatto, poi rilegge.
 */
import { downloadJavaLibrarySources, resolveJavaLibrarySource, type GoIDEDependencySource, type JavaLibrary } from '@/lib/code-studio-api'
import { confirm } from '@/lib/confirmDialog'
import { findLibrary, javaBuildTools, libraryCoordinate, type JavaBuildTool } from '@/lib/code-studio/javaLibraries'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useJavaLibrariesStore } from '@/stores/codeStudioJavaLibraries'
import { entryFileOf, openDependencySourceFile } from './codeStudioDependencySource'

type Coordinate = Pick<JavaLibrary, 'groupId' | 'artifactId' | 'version'>

function fail(message: string): null {
  useCodeStudioStore.setState({ error: message })
  return null
}

/** Il build tool del progetto: decide comando e messaggio del download dei sorgenti. */
export function javaBuildToolOf(sessionId: string): JavaBuildTool {
  const session = useCodeStudioStore.getState().sessions.find((item) => item.id === sessionId)
  return javaBuildTools(session?.project.units ?? [])[0] ?? 'maven'
}

/** Il comando che scarica i sorgenti, come lo vede l'utente nella conferma. */
export const sourcesDownloadCommand = (library: Coordinate, buildTool: JavaBuildTool = 'maven') => buildTool === 'gradle'
  ? `gradle adomniaSources -Padomnia.coordinate=${libraryCoordinate(library)}`
  : `mvn dependency:get -Dartifact=${libraryCoordinate(library)}:jar:sources -Dtransitive=false`

/** Scarica i sorgenti dopo la conferma; true se ora ci sono. */
export async function downloadLibrarySources(sessionId: string, library: Coordinate, buildTool: JavaBuildTool = javaBuildToolOf(sessionId)): Promise<boolean> {
  const accepted = await confirm({
    title: 'Download library sources?',
    message: buildTool === 'gradle'
      ? `The sources of ${libraryCoordinate(library)} are not in the local Gradle cache.\n\nadOmnia runs Gradle with an init script and a detached configuration for the sources artifact, using the repositories in your build.\n\nCommand: ${sourcesDownloadCommand(library, buildTool)}`
      : `The sources of ${libraryCoordinate(library)} are not in the local Maven repository.\n\nCommand: ${sourcesDownloadCommand(library, buildTool)}\n\nMaven downloads the sources jar from the repositories in your settings.xml.`,
    details: [{ label: 'Library', value: libraryCoordinate(library), mono: true }],
    confirmLabel: 'Download',
  })
  if (!accepted) return false
  try {
    await downloadJavaLibrarySources(sessionId, library.groupId, library.artifactId, library.version)
    void useJavaLibrariesStore.getState().load(sessionId, true)
    return true
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return false
  }
}

/** Il sorgente pronto di una libreria, scaricandolo prima se serve e l'utente lo conferma. */
export async function ensureJavaLibrarySource(sessionId: string, library: Coordinate, buildTool: JavaBuildTool = javaBuildToolOf(sessionId)): Promise<GoIDEDependencySource | null> {
  try {
    const source = await resolveJavaLibrarySource(sessionId, library.groupId, library.artifactId, library.version)
    if (source.downloaded) return source
    if (!await downloadLibrarySources(sessionId, library, buildTool)) return null
    const downloaded = await resolveJavaLibrarySource(sessionId, library.groupId, library.artifactId, library.version)
    return downloaded.downloaded ? downloaded : fail(downloaded.reason || `The sources of ${libraryCoordinate(library)} are not available.`)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

/** La libreria `group:artifact` con la versione che il build risolve (anche quella ereditata da parent o BOM). */
export async function resolvedLibrary(sessionId: string, groupId: string, artifactId: string, module?: string): Promise<JavaLibrary | null> {
  const libraries = await useJavaLibrariesStore.getState().load(sessionId)
  const library = libraries && findLibrary(libraries.libraries, groupId, artifactId, module)
  if (library) return library
  // Una dipendenza appena aggiunta: si rilegge una volta prima di arrendersi. Per Gradle la rilettura
  // esegue il build, quindi si aspetta il salvataggio del build file (che ricarica la lista).
  const fresh = javaBuildToolOf(sessionId) === 'gradle' ? libraries : await useJavaLibrariesStore.getState().load(sessionId, true)
  return (fresh && findLibrary(fresh.libraries, groupId, artifactId, module)) ?? fail(`${groupId}:${artifactId} is not resolved yet: build the project once so the build downloads it.`)
}

/** Apre il file d'ingresso di una libreria e la mostra in External Libraries. */
export async function openJavaLibrarySource(sessionId: string, library: Coordinate): Promise<void> {
  const source = await ensureJavaLibrarySource(sessionId, library)
  if (!source) return
  if (openDependencySourceFile(source, sessionId, entryFileOf(source))) useCodeStudioStore.getState().updateLayout({ projectOpen: true })
}
