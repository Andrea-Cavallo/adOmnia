import * as GitSyncBindings from '../../../bindings/adomnia/gitsync'

export interface LocalReplaceInfo {
  file: string
  module: string
  target: string
}

export function localReplaceWarning(replaces: readonly LocalReplaceInfo[]): string {
  const lines = replaces.slice(0, 8).map((item) => `• ${item.file}: ${item.module} => ${item.target}`)
  const more = replaces.length > 8 ? `\n…and ${replaces.length - 8} more` : ''
  return `The commits you are pushing contain a local replace in go.mod:\n\n${lines.join('\n')}${more}\n\nThose folders exist only on this machine: anyone else (and CI) will fail to build. Push anyway?`
}

/** Prima di un push: se un go.mod committato punta a una cartella locale, l'utente deve confermare. */
export async function confirmPushWithLocalReplaces(repoPath: string): Promise<boolean> {
  let replaces: LocalReplaceInfo[] = []
  try {
    replaces = (await GitSyncBindings.LocalReplaces(repoPath)) ?? []
  } catch {
    // Il controllo è un aiuto: se fallisce (repo senza commit, git assente) il push resta possibile.
    return true
  }
  return replaces.length === 0 || window.confirm(localReplaceWarning(replaces))
}

/** Esegue push solo dopo la conferma; altrimenti fallisce con un messaggio chiaro. */
export async function guardedPush<T>(repoPath: string, push: () => Promise<T>): Promise<T> {
  if (!await confirmPushWithLocalReplaces(repoPath)) throw new Error('Push cancelled: go.mod still has a local replace.')
  return push()
}
