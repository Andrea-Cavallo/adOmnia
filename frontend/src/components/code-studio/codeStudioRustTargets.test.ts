import { describe, expect, it } from 'vitest'
import { findRustTargets, findRustTestTargets } from './codeStudioRustTargets'

describe('findRustTargets', () => {
  it('puts the run glyph on fn main, including async and attribute forms', () => {
    expect(findRustTargets('src/main.rs', 'use x;\n\n#[tokio::main]\nasync fn main() {}\n')).toEqual([
      { line: 4, kind: 'rust-main', name: 'main', crateDirectory: '' },
    ])
    expect(findRustTargets('crates/api/src/main.rs', 'fn main() {}')).toEqual([
      { line: 1, kind: 'rust-main', name: 'api', crateDirectory: 'crates/api' },
    ])
  })

  it('maps src/bin and examples to their cargo target', () => {
    expect(findRustTargets('svc/src/bin/worker.rs', 'pub fn main() {}')[0]).toMatchObject({ bin: 'worker', crateDirectory: 'svc' })
    expect(findRustTargets('svc/src/bin/job/main.rs', 'fn main() {}')[0]).toMatchObject({ bin: 'job', crateDirectory: 'svc' })
    expect(findRustTargets('svc/examples/demo.rs', 'fn main() {}')[0]).toMatchObject({ example: 'demo', crateDirectory: 'svc' })
  })

  it('ignores files without a main or outside a crate layout', () => {
    expect(findRustTargets('src/lib.rs', 'pub fn main_menu() {}')).toEqual([])
    expect(findRustTargets('src/util.rs', 'fn main() {}')).toEqual([])
    expect(findRustTargets('src/main.go', 'fn main() {}')).toEqual([])
  })
})

describe('findRustTestTargets', () => {
  const source = [
    'pub fn add(a: u32, b: u32) -> u32 { a + b }',
    '',
    '#[cfg(test)]',
    'mod tests {',
    '    use super::*;',
    '',
    '    #[test]',
    '    fn adds() { assert_eq!(add(1, 2), 3); }',
    '',
    '    #[tokio::test(flavor = "multi_thread")]',
    '    #[ignore]',
    '    async fn adds_later() { let s = "}"; }',
    '',
    '    mod nested {',
    '        #[test]',
    '        fn deep() {}',
    '    }',
    '',
    '    #[test]',
    '    fn after_nested() {}',
    '}',
    '',
    'fn not_a_test() {}',
  ].join('\n')

  it('builds the exact libtest path from file and inline modules, with braces in strings ignored', () => {
    const targets = findRustTestTargets('crates/api/src/handlers/user.rs', source)
    expect(targets.map((target) => [target.line, target.testPath])).toEqual([
      [8, 'handlers::user::tests::adds'],
      [12, 'handlers::user::tests::adds_later'],
      [16, 'handlers::user::tests::nested::deep'],
      [20, 'handlers::user::tests::after_nested'],
    ])
    expect(targets[0].crateDirectory).toBe('crates/api')
  })

  it('treats lib.rs as the crate root and integration tests as their own crate', () => {
    expect(findRustTestTargets('src/lib.rs', '#[test]\nfn top() {}')[0]).toMatchObject({ testPath: 'top', crateDirectory: '' })
    expect(findRustTestTargets('svc/tests/api.rs', '#[test]\nfn health() {}')[0]).toMatchObject({ testPath: 'health', crateDirectory: 'svc' })
    expect(findRustTestTargets('src/main.go', '#[test]\nfn x() {}')).toEqual([])
  })
})
