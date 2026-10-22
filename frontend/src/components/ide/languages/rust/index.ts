import type { IdeLanguageContribution } from '../../languages'

/** ID del language adapter backend (`internal/languages/rust`). */
export const RUST_LANGUAGE_ID = 'rust'

/**
 * Rust (Cargo). L'adapter rileva crate e workspace, riconosce i file `.rs`/Cargo e ora esegue
 * (cargo run/build/check/example/bench/clippy, RS-3). Non ha ancora test strutturati (RS-5), debug
 * (RS-6) né rust-analyzer (RS-4): nessun `languageServer`/`providedServer` e nessun `canDebugRun`.
 * `heavyFeatures: false` lascia fuori le funzioni tarate su gopls finché non c'è un server.
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
  heavyFeatures: false,
}
