/** Etichetta del badge di un candidato toolchain Rust con un problema (RS-2.1, RS-2.2). */
export type RustToolchainProblemBadge = 'not installed' | 'no probe' | 'problem'

/**
 * Il `problem` del candidato può dire tre cose diverse: un canale dichiarato dal progetto che non è
 * installato (con il comando `rustup toolchain install …`), una toolchain che non risponde al probe
 * `rustc -vV`, oppure un problema generico. Il badge deve dirlo, non chiamare tutto "no probe".
 */
export function rustToolchainProblemBadge(problem: string): RustToolchainProblemBadge {
  if (/not installed/i.test(problem)) return 'not installed'
  if (/probe/i.test(problem)) return 'no probe'
  return 'problem'
}
