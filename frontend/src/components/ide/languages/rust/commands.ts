import type { CodeStudioCommand } from '@/components/code-studio/codeStudioCommands'
import { RUST_LANGUAGE_ID } from '.'

export type RustLanguageCommandId = 'rust.installDebugger' | 'rust.selectToolchain' | 'rust.dependencyTree' | 'rust.environment'

const requires = { language: RUST_LANGUAGE_ID }

/** Comandi Rust: menu "Rust", visibile solo se il backend registra Rust. */
export const RUST_LANGUAGE_COMMANDS: ReadonlyArray<CodeStudioCommand> = ([
  { id: 'rust.selectToolchain', menu: 'rust', label: 'Select Rust Toolchain…', separatorBefore: true },
  { id: 'rust.environment', menu: 'rust', label: 'Rust Environment…' },
  { id: 'rust.installDebugger', menu: 'rust', label: 'Install CodeLLDB (debugger)…' },
  { id: 'rust.dependencyTree', menu: 'rust', label: 'Cargo.lock Dependency Tree…' },
] satisfies ReadonlyArray<Omit<CodeStudioCommand, 'requires'>>).map((command) => ({ ...command, requires }))
