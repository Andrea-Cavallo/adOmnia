export interface ResourceUiContext {
  view: string
  workspace?: string
  openDocuments?: number
  modifiedDocuments?: number
  activeFile?: string
  runningExecutions?: number
}

let studioContext: (() => Omit<ResourceUiContext, 'view'>) | undefined
export function registerResourceStudioContext(read: () => Omit<ResourceUiContext, 'view'>) {
  studioContext = read
  return () => { if (studioContext === read) studioContext = undefined }
}
export function resourceUiContext(view: string): ResourceUiContext {
  return { view, ...(view === 'codestudio' ? studioContext?.() : {}) }
}
