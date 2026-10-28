import { describe, expect, it } from 'vitest'
import { rustToolchainProblemBadge } from './rustToolchainProblem'

describe('rustToolchainProblemBadge', () => {
  it('chiama "not installed" un canale dichiarato e mancante (RS-2.1)', () => {
    expect(rustToolchainProblemBadge('the 1.75.0 toolchain is not installed: run `rustup toolchain install 1.75.0`')).toBe('not installed')
  })

  it('distingue il probe senza risposta', () => {
    expect(rustToolchainProblemBadge('this toolchain does not answer a rustc probe')).toBe('no probe')
    expect(rustToolchainProblemBadge('no cargo executable to probe')).toBe('no probe')
  })

  it('usa il badge generico per gli altri problemi', () => {
    expect(rustToolchainProblemBadge('the declared toolchain is not available: no cargo in PATH')).toBe('problem')
  })
})
