import type { IdeLanguageContribution } from '../../languages'

/** ID del language adapter backend (`internal/languages/rust`). */
export const RUST_LANGUAGE_ID = 'rust'

/**
 * Rust (Cargo). In RS-0/1 l'adapter rileva crate e workspace e riconosce i file `.rs`/Cargo, ma non
 * ha ancora run/test/debug né rust-analyzer: nessun `languageServer`/`providedServer`, nessun
 * comando. L'editor usa già la colorazione Monaco di `.rs` (mappata in `documents.go`); qui il
 * linguaggio dichiara solo l'identità per icona e raggruppamento. Le capability arrivano con RS-3
 * (run), RS-4 (rust-analyzer), RS-5 (test) e RS-6 (debug).
 */
export const RUST_LANGUAGE: IdeLanguageContribution = {
  id: RUST_LANGUAGE_ID,
  name: 'Rust',
  icon: 'rust',
  editorLanguages: ['rust'],
  // Nessun server finché rust-analyzer non esiste (RS-4): niente funzioni pesanti né colori semantici.
  heavyFeatures: false,
}
