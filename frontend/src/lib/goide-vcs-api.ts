import * as GoIDEBindings from '../../bindings/adomnia/goide'
import type { VCSBlameLine, VCSCommit, VCSFileChange, VCSStatus } from '../../bindings/adomnia/internal/goide/models'
import type { CommitResult } from '../../bindings/adomnia/internal/git/models'

export type GoIDEVCSStatus = VCSStatus
export type GoIDEVCSFileChange = VCSFileChange
export type GoIDEVCSCommit = VCSCommit
export type GoIDEVCSBlameLine = VCSBlameLine

/** Branch e modifiche del repository del progetto; nessuna operazione di rete. */
export function getGoIDEVCSStatus(sessionId: string): Promise<VCSStatus> {
  return GoIDEBindings.VCSStatus(sessionId)
}

export function getGoIDEFileAtRevision(sessionId: string, relativePath: string, revision: string): Promise<string> {
  return GoIDEBindings.VCSFileAtRevision(sessionId, relativePath, revision)
}

export function getGoIDEFileHistory(sessionId: string, relativePath: string): Promise<VCSCommit[]> {
  return GoIDEBindings.VCSFileHistory(sessionId, relativePath)
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
