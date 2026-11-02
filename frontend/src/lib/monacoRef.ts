import type * as Monaco from 'monaco-editor'

/**
 * Monaco without importing it. Code Studio modules that only act on existing editors or models read
 * Monaco from here, so opening Code Studio with no file open does not load the ~1 MB editor bundle.
 * `monacoSetup` fills the binding when the first editor loads; before that no model or editor exists.
 * Code that can run before any editor (store subscriptions, commands) must check `isMonacoLoaded()`.
 */
export let monaco = undefined as unknown as typeof Monaco

export function setLoadedMonaco(instance: typeof Monaco): void {
  monaco = instance
}

export function isMonacoLoaded(): boolean {
  return monaco !== undefined
}

export type { Monaco }
