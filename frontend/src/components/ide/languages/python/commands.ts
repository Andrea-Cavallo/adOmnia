import type { CodeStudioCommand } from '@/components/code-studio/codeStudioCommands'
import { PYTHON_LANGUAGE_ID } from '.'

export type PythonLanguageCommandId =
  | 'python.selectInterpreter' | 'python.installDebugpy' | 'python.attach'

const requires = { language: PYTHON_LANGUAGE_ID }

/** Comandi Python: tutti nel menu "Python", visibili solo se il backend registra Python. */
export const PYTHON_LANGUAGE_COMMANDS: ReadonlyArray<CodeStudioCommand> = ([
  { id: 'python.selectInterpreter', menu: 'python', label: 'Select Python Interpreter…', separatorBefore: true },
  { id: 'python.installDebugpy', menu: 'python', label: 'Install debugpy…' },
  { id: 'python.attach', menu: 'python', label: 'Attach to Running Debugpy…', separatorBefore: true },
] satisfies ReadonlyArray<Omit<CodeStudioCommand, 'requires'>>).map((command) => ({ ...command, requires }))
