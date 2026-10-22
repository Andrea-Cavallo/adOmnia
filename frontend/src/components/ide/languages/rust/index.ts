import type { IdeLanguageContribution } from '../../languages'

/** ID del language adapter backend (`internal/languages/rust`). */
export const RUST_LANGUAGE_ID = 'rust'

/**
 * Rust (Cargo). L'adapter rileva crate e workspace, esegue (cargo run/build/check/example/bench,
 * RS-3) e ora serve l'editor con rust-analyzer (RS-4, installato esplicitamente via rustup e avviato
 * dal backend `lsp.ServerProvider`). `heavyFeatures` resta spento: colori semantici, inlay hints e
 * Code Vision vanno verificati con rust-analyzer in app (RS-4.5 / RS-M3) prima di accenderli.
 */
export const RUST_LANGUAGE: IdeLanguageContribution = {
  id: RUST_LANGUAGE_ID,
  name: 'Rust',
  icon: 'rust',
  runTemplates: [
    { language: 'rust', kind: 'bin', label: 'Rust binary', group: 'Rust' },
    { language: 'rust', kind: 'example', label: 'Rust example', group: 'Rust' },
    { language: 'rust', kind: 'build', label: 'Rust build', group: 'Rust' },
    { language: 'rust', kind: 'check', label: 'Rust check', group: 'Rust' },
  ],
  editorLanguages: ['rust'],
  languageServer: 'rust-analyzer',
  heavyFeatures: false,
  providedServer: true,
}
