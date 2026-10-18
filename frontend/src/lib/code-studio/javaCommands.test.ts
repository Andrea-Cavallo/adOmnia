import { describe, expect, it } from 'vitest'
import { javaCounterpartPaths, javaGoalSuggestion, javaNameError, javaPackageOfDirectory, javaSourceTemplate, javaTargetAtLine } from './javaCommands'

const suggestion = (workingDirectory: string, programArguments: string[]) => ({ language: 'java', configuration: { kind: 'command', target: 'mvn', workingDirectory, programArguments } })

describe('javaGoalSuggestion', () => {
  const list = [suggestion('.', ['test']), suggestion('api', ['test']), suggestion('api', ['clean', 'install'])]
  it('picks the innermost unit containing the file', () => {
    expect(javaGoalSuggestion(list, ['test'], 'api/src/A.java')?.configuration.workingDirectory).toBe('api')
    expect(javaGoalSuggestion(list, ['test'], 'web/src/A.java')?.configuration.workingDirectory).toBe('.')
  })
  it('matches goals exactly and returns null when absent', () => {
    expect(javaGoalSuggestion(list, ['clean', 'install'], '')?.configuration.programArguments).toEqual(['clean', 'install'])
    expect(javaGoalSuggestion(list, ['package'], '')).toBeNull()
  })
})

describe('javaTargetAtLine', () => {
  const t = (line: number) => ({ line, kind: 'java-test' as const, name: `m${line}`, className: 'A', relativePath: 'A.java' })
  it('takes the last target above the cursor, else the first', () => {
    expect(javaTargetAtLine([t(5), t(20)], 'java-test', 25)?.line).toBe(20)
    expect(javaTargetAtLine([t(5), t(20)], 'java-test', 1)?.line).toBe(5)
    expect(javaTargetAtLine([t(5)], 'java-main', 1)).toBeNull()
  })
})

describe('javaCounterpartPaths', () => {
  it('maps source to test candidates and back', () => {
    expect(javaCounterpartPaths('src/main/java/a/Foo.java')[0]).toBe('src/test/java/a/FooTest.java')
    expect(javaCounterpartPaths('mod/src/test/java/a/FooTest.java')).toEqual(['mod/src/main/java/a/Foo.java'])
    expect(javaCounterpartPaths('README.md')).toEqual([])
  })
})

describe('new Java entries', () => {
  it('validates names', () => {
    expect(javaNameError('class', 'UserService')).toBe('')
    expect(javaNameError('class', 'userService')).not.toBe('')
    expect(javaNameError('class', 'class')).not.toBe('')
    expect(javaNameError('package', 'com.acme.app')).toBe('')
    expect(javaNameError('package', 'com.Acme')).not.toBe('')
    expect(javaNameError('package', 'com.new')).not.toBe('')
  })
  it('derives the package and renders the template', () => {
    expect(javaPackageOfDirectory('svc/src/main/java/com/acme')).toBe('com.acme')
    expect(javaPackageOfDirectory('src/main/java')).toBe('')
    expect(javaSourceTemplate('class', 'A', 'com.acme')).toBe('package com.acme;\n\npublic class A {\n}\n')
    expect(javaSourceTemplate('record', 'P', '')).toBe('public record P() {\n}\n')
  })
})
