import { describe, expect, it } from 'vitest'
import { environmentRows, formatBytes } from './rustEnvironment'

describe('formatBytes', () => {
  it('mostra una dimensione leggibile', () => {
    expect(formatBytes(0)).toBe('empty')
    expect(formatBytes(-1)).toBe('empty')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
    expect(formatBytes(150 * 1024)).toBe('150 KB')
  })
})

describe('environmentRows', () => {
  it('mette variabili, alias, env e target in righe stabili', () => {
    const rows = environmentRows({
      cargoHome: 'C:/Users/me/.cargo',
      rustupHome: 'C:/Users/me/.rustup',
      targetDir: '',
      rustFlags: '-C target-cpu=native',
      aliases: { lint: 'clippy --all-targets', b: 'build' },
      env: { RUST_BACKTRACE: '1' },
      targets: {
        'x86_64-pc-windows-msvc': { linker: 'lld-link' },
        'aarch64-apple-darwin': { runner: 'qemu' },
      },
    })
    expect(rows.map((row) => row.key)).toEqual([
      'CARGO_HOME',
      'RUSTUP_HOME',
      'CARGO_TARGET_DIR',
      'RUSTFLAGS',
      'alias b',
      'alias lint',
      'RUST_BACKTRACE',
      'target aarch64-apple-darwin',
      'target x86_64-pc-windows-msvc',
    ])
    expect(rows[2].source).toBe('default target/')
    expect(rows[8].value).toBe('linker lld-link')
  })

  it('tiene la riga del target-dir quando è configurato', () => {
    const rows = environmentRows({ targetDir: 'D:/cargo-target' })
    expect(rows.find((row) => row.key === 'CARGO_TARGET_DIR')?.source).toBe('config/.cargo')
  })

  it('non inventa righe per un ambiente vuoto', () => {
    expect(environmentRows({})).toHaveLength(4)
  })
})
