import { describe, expect, it } from 'vitest'
import { findRustTargets } from './codeStudioRustTargets'

const main = 'use std::io;\nfn main(){\n}\n'

describe('Rust files outside a Cargo crate', () => {
  it('gets a ▶ on fn main, run from the file folder', () => {
    expect(findRustTargets('learning-rust/fibonacci/fibonacci.rs', main)).toMatchObject([
      { line: 2, kind: 'rust-main', name: 'fibonacci', crateDirectory: 'learning-rust/fibonacci', source: 'fibonacci.rs' },
    ])
  })

  it('works at the project root', () => {
    expect(findRustTargets('hello.rs', main)).toMatchObject([{ crateDirectory: '', source: 'hello.rs' }])
  })

  it('leaves crate modules and build scripts alone', () => {
    expect(findRustTargets('app/src/util.rs', main)).toEqual([])
    expect(findRustTargets('app/build.rs', main)).toEqual([])
    expect(findRustTargets('app/tests/it.rs', main)).toEqual([])
  })

  it('keeps Cargo targets as they were', () => {
    expect(findRustTargets('app/src/main.rs', main)).toMatchObject([{ crateDirectory: 'app', name: 'app' }])
  })
})
