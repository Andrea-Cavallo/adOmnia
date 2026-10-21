import { describe, expect, it } from 'vitest'
import { configurationCatalog, templateWorkingDirectory } from './runConfigurationCatalog'
import type { RunTemplate } from './runFormTypes'

const templates: RunTemplate[] = [
  { language: '', kind: 'command', group: 'Generic', label: 'Command' },
  { language: 'python', kind: 'script', group: 'Python', label: 'Script' },
  { language: 'java', kind: 'main', group: 'Java', label: 'Main class' },
  { language: 'go', kind: 'package', group: 'Go', label: 'Package' },
]
const project = { rootPath: 'C:\\repo', units: [{ language: 'python', root: 'C:\\repo\\services\\ml' }] }

describe('project-aware configuration catalog', () => {
  it('prioritizes project languages and hides unavailable adapters', () => {
    const catalog = configurationCatalog(templates, project, [{ id: 'python' }, { id: 'java' }], '')
    expect(catalog.project.map(item => item.language)).toEqual(['python'])
    expect(catalog.tools.map(item => item.kind)).toEqual(['command'])
    expect(catalog.other.map(item => item.language)).toEqual(['java'])
  })
  it('searches type and language names, ignoring case and whitespace', () => {
    expect(configurationCatalog(templates, project, undefined, ' PYTHON ').project).toEqual([templates[1]])
    expect(configurationCatalog(templates, project, undefined, 'main').other).toEqual([templates[2]])
    expect(configurationCatalog(templates, project, undefined, 'missing')).toEqual({ project: [], tools: [], other: [] })
  })
  it('defaults cwd only for one unit inside the project', () => {
    expect(templateWorkingDirectory(templates[1], project)).toBe('services/ml')
    expect(templateWorkingDirectory(templates[0], project)).toBe('')
    expect(templateWorkingDirectory(templates[1], { ...project, units: [...project.units, { language: 'python', root: 'C:/repo/another' }] })).toBe('')
    expect(templateWorkingDirectory(templates[1], { ...project, units: [{ language: 'python', root: 'C:/repo-other/ml' }] })).toBe('')
  })
})
