import { describe, expect, it } from 'vitest'
import { JAVA_LANGUAGE_COMMANDS } from './commands'

describe('Java language commands', () => {
  it('every command requires the java language and has a unique id', () => {
    const ids = JAVA_LANGUAGE_COMMANDS.map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const command of JAVA_LANGUAGE_COMMANDS) expect(command.requires).toEqual({ language: 'java' })
  })
})
