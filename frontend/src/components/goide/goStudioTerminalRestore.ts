import { projectRelativePath } from './goStudioTerminalLinks'

/** Metadati di un terminale da riaprire alla prossima apertura del progetto (mai l'output né i processi). */
export interface GoStudioSavedTerminal {
  id: string
  name: string
  profile: string
  /** Relativa alla radice del progetto, così sopravvive a un progetto spostato. */
  workingDirectory: string
}

const SAVED_KEY = 'adomnia.goide.terminals:'
const MAX_SAVED = 8

export function readSavedTerminals(projectPath: string): GoStudioSavedTerminal[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_KEY + projectPath) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is GoStudioSavedTerminal => !!item && typeof item.name === 'string' && typeof item.profile === 'string' && typeof item.workingDirectory === 'string')
      .slice(0, MAX_SAVED)
  } catch {
    return []
  }
}

export function writeSavedTerminals(projectPath: string, terminals: GoStudioSavedTerminal[]): void {
  try { localStorage.setItem(SAVED_KEY + projectPath, JSON.stringify(terminals.slice(0, MAX_SAVED))) } catch { /* solo locale */ }
}

/** Fotografa i terminali aperti; il profilo viene da quanto noto in sessione o dal salvataggio precedente con lo stesso id. */
export function snapshotTerminals(
  terminals: ReadonlyArray<{ id: string; name: string; workingDirectory: string }>,
  profiles: ReadonlyMap<string, string>,
  previous: ReadonlyArray<GoStudioSavedTerminal>,
  projectRoots: readonly string[],
): GoStudioSavedTerminal[] {
  return terminals.map((terminal) => ({
    id: terminal.id,
    name: terminal.name,
    profile: profiles.get(terminal.id) ?? previous.find((item) => item.id === terminal.id)?.profile ?? '',
    workingDirectory: projectRelativePath(terminal.workingDirectory, projectRoots) ?? '',
  }))
}
