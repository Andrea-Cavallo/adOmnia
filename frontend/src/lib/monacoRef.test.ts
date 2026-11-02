import { describe, expect, it, vi } from 'vitest'

// Importing Monaco from any of these modules would put ~1 MB back on Code Studio's startup path.
vi.mock('monaco-editor', () => { throw new Error('monaco-editor imported before an editor exists') })
vi.mock('@monaco-editor/react', () => { throw new Error('@monaco-editor/react imported before an editor exists') })

const modules = import.meta.glob(['../components/code-studio/codeStudio*.ts', '../components/ide/languages/web/*.ts', '!**/*.test.ts'])

describe('Code Studio without Monaco', () => {
  it('loads every editor-feature module without Monaco and without touching it', async () => {
    const { isMonacoLoaded } = await import('./monacoRef')
    const failures: string[] = []
    for (const [path, load] of Object.entries(modules)) {
      try { await load() } catch (error) { failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    expect(failures).toEqual([])
    expect(isMonacoLoaded()).toBe(false)
  }, 60_000)

  it('builds model keys with the same encoding as monaco.Uri', async () => {
    const { editorModelUri, fileUri } = await import('../components/code-studio/codeStudioModelUri')
    expect(editorModelUri({ uri: 'file:///c:/Users/A b/x.go', sessionId: 's1' })).toBe('file:///c%3A/Users/A%20b/x.go#session%3Ds1')
    expect(fileUri('file:///C:/x%20y/é.ts#session=s1')).toBe('file:///c%3A/x%20y/%C3%A9.ts')
  })
})
