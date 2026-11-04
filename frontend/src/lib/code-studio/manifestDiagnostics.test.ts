import { describe, expect, it } from 'vitest'
import { manifestIssues } from './manifestDiagnostics'

const messages = (text: string) => manifestIssues(text).map((issue) => `${issue.line}: ${issue.message}`)

describe('manifest diagnostics', () => {
  it('accepts a real OSGi manifest', () => {
    const good = [
      'Manifest-Version: 1.0',
      'Bundle-ManifestVersion: 2',
      'Bundle-SymbolicName: org.camunda.bpm.modeler.runtime',
      ' .engine.model;singleton:=true',
      'Bundle-Version: 1.0.0.qualifier',
      'Require-Bundle: org.eclipse.core.runtime,',
      ' org.eclipse.bpmn2;visibility:=reexport',
      'Bundle-ActivationPolicy: lazy',
    ].join('\n')
    expect(manifestIssues(good)).toEqual([])
  })

  it('catches the typo that no compiler would report', () => {
    expect(messages('Manifest-Version: 1.0\nBundle-SymbloicName: core\n')).toContain(
      '2: Unknown header Bundle-SymbloicName; did you mean Bundle-SymbolicName?',
    )
  })

  it('does not invent headers: an unknown name far from every known one stays quiet', () => {
    expect(messages('Manifest-Version: 1.0\nX-Custom-Header: 1\n')).toEqual([])
  })

  it('reports malformed lines, duplicates and long lines', () => {
    const text = [
      'Manifest-Version: 1.0',
      'Bundle-SymbolicName core',
      'Created-By: test',
      'Created-By: again',
      `Bundle-Description: ${'x'.repeat(90)}`,
    ].join('\n')
    const found = messages(text)
    expect(found.some((message) => message.startsWith('2: Expected "Name: value"'))).toBe(true)
    expect(found).toContain('4: Created-By is already declared on line 3; the last value wins.')
    expect(found.some((message) => message.includes('longer than 72 bytes'))).toBe(true)
  })

  it('refuses a bundle without Bundle-ManifestVersion and a bad version', () => {
    const text = 'Manifest-Version: 1.0\nBundle-SymbolicName: core\nBundle-Version: one\n'
    const found = messages(text)
    expect(found).toContain('1: Bundle-ManifestVersion: 2 is missing: without it Equinox does not read this as a bundle.')
    expect(found.some((message) => message.includes('not a valid OSGi version'))).toBe(true)
  })

  it('says when there is nothing to read', () => {
    expect(manifestIssues('')).toContainEqual({
      line: 1, column: 1, severity: 'warning', message: 'This manifest has no header.',
    })
  })
})
