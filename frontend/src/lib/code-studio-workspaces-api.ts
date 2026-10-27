import * as GoIDEBindings from '../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import type { StudioWorkspace, StudioWorkspaces } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'

export type GoIDEStudioWorkspace = StudioWorkspace
export type GoIDEStudioWorkspaces = StudioWorkspaces

/** Id del workspace Code Studio sempre presente (stesso valore del backend). */
export const DEFAULT_STUDIO_WORKSPACE_ID = 'default'

export function listGoIDEStudioWorkspaces(): Promise<StudioWorkspaces> {
  return GoIDEBindings.ListStudioWorkspaces()
}

export function createGoIDEStudioWorkspace(name: string): Promise<StudioWorkspaces> {
  return GoIDEBindings.CreateStudioWorkspace(name)
}

export function renameGoIDEStudioWorkspace(id: string, name: string): Promise<StudioWorkspaces> {
  return GoIDEBindings.RenameStudioWorkspace(id, name)
}

export function deleteGoIDEStudioWorkspace(id: string): Promise<StudioWorkspaces> {
  return GoIDEBindings.DeleteStudioWorkspace(id)
}

export function activateGoIDEStudioWorkspace(id: string): Promise<StudioWorkspaces> {
  return GoIDEBindings.SetActiveStudioWorkspace(id)
}
