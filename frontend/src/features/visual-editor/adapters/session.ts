import { makeAutoObservable } from 'mobx'
import type { Action } from '@onlook/models'
import { HistoryManager } from '@ve-client/components/store/editor/history'
import type { EditorEngine } from '@ve-client/components/store/editor/engine'
import type { WorkspaceCodeEditor } from './file-system'

export interface BranchData {
  branch: { id: string }
  codeEditor: WorkspaceCodeEditor
  history: HistoryManager
}

/**
 * The engine addresses files and history per "branch". In adOmnia one Code Studio session is
 * the only branch: its id is the session id, its files are the session workspace.
 */
export class BranchManager {
  private readonly data: BranchData

  readonly activeError = {
    // The code manager already reports the failure through its toast: nothing to add here.
    addCodeApplicationError: (_message: string, _action: Action) => {},
  }

  constructor(engine: EditorEngine, sessionId: string, codeEditor: WorkspaceCodeEditor) {
    this.data = { branch: { id: sessionId }, codeEditor, history: new HistoryManager(engine) }
    makeAutoObservable(this)
  }

  get activeBranch() {
    return this.data.branch
  }

  get activeHistory(): HistoryManager {
    return this.data.history
  }

  get activeCodeEditor(): WorkspaceCodeEditor {
    return this.data.codeEditor
  }

  getBranchDataById(branchId: string): BranchData | null {
    return branchId === this.data.branch.id ? this.data : null
  }

  clear() {
    this.data.history.clear()
  }
}
