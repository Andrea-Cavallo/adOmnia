import { describe, expect, it } from 'vitest'
import { isPythonDependencyManifest, pythonUnitOfManifest } from './pythonDependencyManifest'

describe('Python dependency manifests', () => {
  it('recognises requirements files and pyproject.toml', () => {
    for (const name of ['requirements.txt', 'requirements-dev.txt', 'requirements-prod.txt', 'Requirements.TXT', 'pyproject.toml']) {
      expect(isPythonDependencyManifest(name)).toBe(true)
    }
    for (const name of ['requirements.in', 'Pipfile', 'setup.py', 'app.py']) {
      expect(isPythonDependencyManifest(name)).toBe(false)
    }
  })

  it('resolves the unit directory of a manifest', () => {
    expect(pythonUnitOfManifest('requirements.txt')).toBe('')
    expect(pythonUnitOfManifest('api/requirements.txt')).toBe('api')
    expect(pythonUnitOfManifest('services\\api\\pyproject.toml')).toBe('services/api')
  })
})
