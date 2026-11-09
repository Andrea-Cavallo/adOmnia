import type { CodeStudioCommand } from '@/components/code-studio/codeStudioCommands'
import { JAVA_LANGUAGE_ID } from '.'

export type JavaLanguageCommandId =
  | 'java.runMain' | 'java.debugMain' | 'java.runTest' | 'java.debugTest' | 'java.springBootRun' | 'java.installTestLauncher' | 'java.installDecompiler'
  | 'java.mvnCompile' | 'java.mvnTest' | 'java.mvnPackage' | 'java.mvnCleanInstall'
  | 'java.optimizeImports' | 'java.goToTest' | 'java.generate'
  | 'java.checkUpdates' | 'java.scanVulnerabilities' | 'java.selectJdk' | 'java.dependencyTree' | 'java.osgi' | 'java.osgiBuild' | 'java.osgiRun' | 'java.osgiDebug' | 'java.osgiExport' | 'java.osgiExportP2' | 'java.flowExplorer' | 'java.jvmMonitor' | 'java.springEndpoints' | 'java.springBeanGraph'

const requires = { language: JAVA_LANGUAGE_ID }

/** Comandi Java: tutti nel menu "Java" (come "Go" per Go), visibili solo se il backend registra Java. */
export const JAVA_LANGUAGE_COMMANDS: ReadonlyArray<CodeStudioCommand> = ([
  { id: 'java.runMain', menu: 'java', label: 'Run Main Class' },
  { id: 'java.debugMain', menu: 'java', label: 'Debug Main Class' },
  { id: 'java.runTest', menu: 'java', label: 'Run Test at Cursor' },
  { id: 'java.debugTest', menu: 'java', label: 'Debug Test at Cursor' },
  { id: 'java.installTestLauncher', menu: 'java', label: 'Install JUnit Console Launcher (Ant, Eclipse)…' },
  { id: 'java.installDecompiler', menu: 'java', label: 'Install Java Decompiler (Vineflower)…' },
  { id: 'java.springBootRun', menu: 'java', label: 'Run Application (Spring Boot, Quarkus, Micronaut)' },
  { id: 'java.springEndpoints', menu: 'java', label: 'Spring Endpoints…', separatorBefore: true },
  { id: 'java.springBeanGraph', menu: 'java', label: 'Spring Bean Graph…' },
  { id: 'java.mvnCompile', menu: 'java', label: 'Build (compile)', separatorBefore: true },
  { id: 'java.mvnTest', menu: 'java', label: 'Maven / Gradle: test' },
  { id: 'java.mvnPackage', menu: 'java', label: 'Maven / Gradle: package' },
  { id: 'java.mvnCleanInstall', menu: 'java', label: 'Maven / Gradle: clean install' },
  { id: 'java.optimizeImports', menu: 'java', label: 'Optimize Imports', separatorBefore: true },
  { id: 'java.generate', menu: 'java', label: 'Generate…' },
  { id: 'java.goToTest', menu: 'java', label: 'Go to Test / Source' },
  { id: 'java.selectJdk', menu: 'java', label: 'Select JDK…', separatorBefore: true },
  { id: 'java.dependencyTree', menu: 'java', label: 'Maven Dependency Tree…' },
  { id: 'java.osgi', menu: 'java', label: 'OSGi Control Center…' },
  { id: 'java.flowExplorer', menu: 'java', label: 'Flow Explorer…' },
  { id: 'java.osgiBuild', menu: 'java', label: 'Build OSGi Bundles' },
  { id: 'java.osgiRun', menu: 'java', label: 'Run OSGi Bundles in Equinox' },
  { id: 'java.osgiDebug', menu: 'java', label: 'Debug OSGi Bundles in Equinox' },
  { id: 'java.osgiExport', menu: 'java', label: 'Export OSGi Bundles…' },
  { id: 'java.osgiExportP2', menu: 'java', label: 'Export OSGi Bundles as p2 Repository…' },
  { id: 'java.jvmMonitor', menu: 'java', label: 'JVM Monitor (heap, GC, JFR)…' },
  { id: 'java.checkUpdates', menu: 'java', label: 'Check for Updates (pom.xml)', separatorBefore: true },
  { id: 'java.scanVulnerabilities', menu: 'java', label: 'Scan Vulnerabilities (pom.xml)' },
] satisfies ReadonlyArray<Omit<CodeStudioCommand, 'requires'>>).map((command) => ({ ...command, requires }))
