import type { CodeStudioCommand } from '@/components/code-studio/codeStudioCommands'
import { JAVA_LANGUAGE_ID } from '.'

export type JavaLanguageCommandId =
  | 'java.runMain' | 'java.debugMain' | 'java.runTest' | 'java.debugTest' | 'java.springBootRun'
  | 'java.mvnTest' | 'java.mvnPackage' | 'java.mvnCleanInstall'
  | 'java.optimizeImports' | 'java.goToTest' | 'java.generate'
  | 'java.checkUpdates' | 'java.scanVulnerabilities'

const requires = { language: JAVA_LANGUAGE_ID }

/** Comandi Java: stesso posto e stessa disponibilità di quelli Go, visibili solo se il backend registra Java. */
export const JAVA_LANGUAGE_COMMANDS: ReadonlyArray<CodeStudioCommand> = ([
  { id: 'java.runMain', menu: 'run', label: 'Java: Run Main Class', separatorBefore: true },
  { id: 'java.debugMain', menu: 'run', label: 'Java: Debug Main Class' },
  { id: 'java.runTest', menu: 'run', label: 'Java: Run Test at Cursor' },
  { id: 'java.debugTest', menu: 'run', label: 'Java: Debug Test at Cursor' },
  { id: 'java.springBootRun', menu: 'run', label: 'Java: Spring Boot Run' },
  { id: 'java.mvnTest', menu: 'run', label: 'Java: Maven test', separatorBefore: true },
  { id: 'java.mvnPackage', menu: 'run', label: 'Java: Maven package' },
  { id: 'java.mvnCleanInstall', menu: 'run', label: 'Java: Maven clean install' },
  { id: 'java.optimizeImports', menu: 'code', label: 'Java: Optimize Imports' },
  { id: 'java.generate', menu: 'code', label: 'Java: Generate…' },
  { id: 'java.goToTest', menu: 'navigate', label: 'Java: Go to Test / Source' },
  { id: 'java.checkUpdates', menu: 'tools', label: 'Maven: Check for Updates (pom.xml)', separatorBefore: true },
  { id: 'java.scanVulnerabilities', menu: 'tools', label: 'Maven: Scan Vulnerabilities (pom.xml)' },
] satisfies ReadonlyArray<Omit<CodeStudioCommand, 'requires'>>).map((command) => ({ ...command, requires }))
