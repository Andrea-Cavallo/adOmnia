import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SchemaGrid } from './CodeStudioRunSchemaFields'
import { commonRunFields, templateFor, runTemplates } from '@/lib/code-studio/runFormSchema'
import { cleanRunConfiguration, emptyRunConfiguration, templateKey } from '@/lib/code-studio/runFormTypes'
import { configurationTestTarget } from '@/lib/code-studio/runToolbarActions'
import type { GoIDESession } from '@/lib/code-studio-api'

describe('shared run configuration form', () => {
  it.each([
    ['go', 'package', 'Target package'],
    ['typescript', 'command', 'Executable'],
    ['', 'command', 'Executable'],
    ['java', 'main', 'Working directory'],
  ])('resolves %s / %s through contribution descriptors', (language, kind, expected) => {
    const draft = { ...emptyRunConfiguration('s'), language, kind } as ReturnType<typeof emptyRunConfiguration>
    const fields = commonRunFields(draft)
    expect(fields.some(field => field.label === expected)).toBe(true)
    expect(fields.some(field => /GOOS|GOARCH|Build tags|Go tool flags/.test(field.label))).toBe(false)
    expect(templateFor(draft).language).toBe(language)
  })
  it('drops blank list rows while preserving spaced arguments and secret markers', () => {
    const draft = { ...emptyRunConfiguration('s'), programArguments: ['-c', 'echo hello world', ''], environment: [{ key: 'TOKEN', value: '', secret: true }] }
    const cleaned = cleanRunConfiguration(draft)
    expect(cleaned.programArguments).toEqual(['-c', 'echo hello world'])
    expect(cleaned.environment[0].secret).toBe(true)
    expect(draft.programArguments).toHaveLength(3)
  })
  it('has no ambiguous provider/type selector keys', () => {
    const keys = runTemplates.map(templateKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('typescript:command')
    expect(keys).toContain(':command')
  })
  it('preserves list argument boundaries and text whitespace in controls', () => {
    const html = renderToStaticMarkup(<SchemaGrid fields={[
      { key: 'args', label: 'Arguments', type: 'list' },
      { key: 'path', label: 'Path', type: 'path', required: true },
    ]} values={{ args: ['-c', 'echo "hello world"'], path: 'a folder/file ' }} set={() => undefined} />)
    expect(html).toContain('-c\necho &quot;hello world&quot;')
    expect(html).toContain('value="a folder/file "')
    expect(html).toContain('required=""')
  })
  it('renders key/value entries and secret controls from schema', () => {
    const html = renderToStaticMarkup(<SchemaGrid fields={[{ key: 'env', label: 'Variables', type: 'keyvalue' }]} values={{ env: [{ key: 'TOKEN', value: '', secret: true }] }} set={() => undefined} />)
    expect(html).toContain('TOKEN')
    expect(html).toContain('asked when you launch')
  })
  it('targets tests at the selected configuration unit in a mixed workspace', () => {
    const project = { rootPath: 'C:/repo', units: [
      { language: 'go', kind: 'module', root: 'C:/repo/api' },
      { language: 'typescript', kind: 'node', root: 'C:/repo/web' },
      { language: 'java', kind: 'maven', root: 'C:/repo/service' },
    ] } as GoIDESession['project']
    const config = { ...emptyRunConfiguration('s'), language: 'typescript', workingDirectory: 'web' }
    expect(configurationTestTarget(project, config)).toMatchObject({ language: 'typescript', workingDirectory: 'web' })
    expect(configurationTestTarget(project, { ...config, language: 'java', workingDirectory: 'service/src' })).toMatchObject({ language: 'java', workingDirectory: 'service' })
    expect(configurationTestTarget(project, { ...config, workingDirectory: 'unknown' })).toBeNull()
  })
})
