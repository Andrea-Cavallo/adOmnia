import { describe, expect, it } from 'vitest'
import { PYTHON_LANGUAGE_COMMANDS } from './commands'

describe('Python language commands', () => {
  it('every command requires the python language and has a unique id', () => {
    const ids = PYTHON_LANGUAGE_COMMANDS.map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const command of PYTHON_LANGUAGE_COMMANDS) expect(command.requires).toEqual({ language: 'python' })
  })
})
