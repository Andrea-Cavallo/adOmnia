import * as GoIDEBindings from '../../bindings/adomnia/goide'
import type { VCSBlameLine, VCSChangedSymbol, VCSCommit, VCSFileChange, VCSStatus } from '../../bindings/adomnia/internal/codestudio/models'
import type { CommitResult } from '../../bindings/adomnia/internal/git/models'

export type GoIDEVCSStatus = VCSStatus
export type GoIDEVCSFileChange = VCSFileChange
export type GoIDEVCSCommit = VCSCommit
export type GoIDEVCSBlameLine = VCSBlameLine
export type GoIDEVCSChangedSymbol = VCSChangedSymbol

/** Branch e modifiche del repository del progetto; nessuna operazione di rete. */
export function getGoIDEVCSStatus(sessionId: string): Promise<VCSStatus> {
  return GoIDEBindings.VCSStatus(sessionId)
}

export function selectGoIDERepository(sessionId: string, root: string): Promise<VCSStatus> {
  return GoIDEBindings.VCSSelectRepository(sessionId, root)
}

export function getGoIDEFileAtRevision(sessionId: string, relativePath: string, revision: string): Promise<string> {
  return GoIDEBindings.VCSFileAtRevision(sessionId, relativePath, revision)
}

export function getGoIDEFileHistory(sessionId: string, relativePath: string): Promise<VCSCommit[]> {
  return GoIDEBindings.VCSFileHistory(sessionId, relativePath)
}

/** Commit che hanno modificato le righe start..end (1-based) del file salvato. */
export function getGoIDELineHistory(sessionId: string, relativePath: string, start: number, end: number): Promise<VCSCommit[]> {
  return GoIDEBindings.VCSLineHistory(sessionId, relativePath, start, end)
}

/** Funzioni, metodi, tipi, costanti e variabili aggiunti, modificati o rimossi rispetto a HEAD (file su disco). */
export function getGoIDEChangedSymbols(sessionId: string): Promise<VCSChangedSymbol[]> {
  return GoIDEBindings.VCSChangedSymbols(sessionId)
}

export function getGoIDEBlame(sessionId: string, relativePath: string): Promise<VCSBlameLine[]> {
  return GoIDEBindings.VCSBlame(sessionId, relativePath)
}

export function commitGoIDEFiles(sessionId: string, message: string, relativePaths: string[]): Promise<CommitResult> {
  return GoIDEBindings.VCSCommitFiles(sessionId, message, relativePaths)
}

export function checkoutGoIDEBranch(sessionId: string, branch: string): Promise<void> {
  return GoIDEBindings.VCSCheckout(sessionId, branch)
}

export function stageGoIDEFiles(sessionId: string, relativePaths: string[], staged: boolean): Promise<void> {
  return GoIDEBindings.VCSStage(sessionId, relativePaths, staged)
}

export function revertGoIDEFiles(sessionId: string, relativePaths: string[]): Promise<void> {
  return GoIDEBindings.VCSRevert(sessionId, relativePaths)
}

export function pullGoIDERepository(sessionId: string): Promise<void> {
  return GoIDEBindings.VCSPull(sessionId)
}

export function pushGoIDERepository(sessionId: string): Promise<void> {
  return GoIDEBindings.VCSPush(sessionId)
}

export interface GoIDELineRange {
  start: number
  end: number
}

/** Righe Go aggiunte o modificate dal merge-base con base (modifiche locali incluse), per file del progetto. */
export async function getGoIDEPatchLines(sessionId: string, base: string): Promise<Record<string, GoIDELineRange[]>> {
  const lines = await GoIDEBindings.VCSPatchLines(sessionId, base)
  return Object.fromEntries(Object.entries(lines).map(([path, ranges]) => [path, (ranges ?? []).map(({ start, end }) => ({ start, end }))]))
}
