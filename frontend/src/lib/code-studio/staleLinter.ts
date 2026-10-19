/**
 * golangci-lint rifiuta di girare quando è stato compilato con un Go più vecchio di quello del progetto
 * ("the Go language version (go1.25) used to build golangci-lint is lower than the targeted Go version (1.26.5)").
 * Si cura ricompilandolo con l'SDK Go del progetto, quindi il pannello lo propone da solo.
 */
const STALE_LINTER = /used to build .*is lower than the targeted Go version/i

export function isStaleLinterError(message: string): boolean {
  return STALE_LINTER.test(message)
}
