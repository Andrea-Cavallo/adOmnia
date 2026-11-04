#!/usr/bin/env node
// Downloads the pinned ripgrep release for the current platform and stages it in build/rg/.
// Release builds bundle it next to the app; the app falls back to its Go engine when it is
// missing, so a failed fetch never breaks a build (pass --required to make it fatal).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RIPGREP_VERSION = '14.1.1'
const BASE = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}`
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const required = process.argv.includes('--required')

const assets = {
  'win32-x64': { file: `ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip`, binary: 'rg.exe', output: 'windows' },
  'linux-x64': { file: `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`, binary: 'rg', output: 'linux' },
  'darwin-arm64': { file: `ripgrep-${RIPGREP_VERSION}-aarch64-apple-darwin.tar.gz`, binary: 'rg', output: 'macos' },
  'darwin-x64': { file: `ripgrep-${RIPGREP_VERSION}-x86_64-apple-darwin.tar.gz`, binary: 'rg', output: 'macos' },
}

async function download(url, path) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  writeFileSync(path, Buffer.from(await response.arrayBuffer()))
}

async function downloadVerified(asset, work) {
  const archive = join(work, asset.file)
  await download(`${BASE}/${asset.file}`, archive)
  const checksumFile = join(work, `${asset.file}.sha256`)
  await download(`${BASE}/${asset.file}.sha256`, checksumFile)
  // The release .sha256 file is the PowerShell Get-FileHash transcript ("sha256 of <asset>:" then
  // the hash), so take the first 64-character hex token rather than the first whitespace token.
  const checksumText = readFileSync(checksumFile, 'utf8')
  const expected = (checksumText.match(/\b[a-f0-9]{64}\b/i)?.[0] ?? '').toLowerCase()
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (!expected) throw new Error(`${asset.file}: no SHA-256 in ${asset.file}.sha256`)
  if (expected !== actual) throw new Error(`${asset.file}: SHA-256 mismatch (${actual} != ${expected})`)
  return archive
}

function extract(archive, work, destination) {
  mkdirSync(destination, { recursive: true })
  if (archive.endsWith('.zip')) {
    execFileSync('tar', ['-xf', archive, '-C', work], { stdio: 'inherit' })
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', work], { stdio: 'inherit' })
  }
  const folder = archive.endsWith('.zip')
    ? archive.split(/[\\/]/).pop().replace(/\.zip$/, '')
    : archive.split(/[\\/]/).pop().replace(/\.tar\.gz$/, '')
  return join(work, folder)
}

function copyLicenses(source, destination) {
  for (const name of ['LICENSE-MIT', 'UNLICENSE', 'COPYING']) {
    const license = join(source, name)
    if (existsSync(license)) execFileSync('cp', ['-f', license, destination])
  }
}

async function main() {
  const key = `${process.platform}-${process.arch}`
  const asset = assets[key]
  if (!asset) throw new Error(`unsupported platform ${key}`)
  const output = join(root, 'build', 'rg', asset.output)
  const marker = join(output, 'version.txt')
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === RIPGREP_VERSION && existsSync(join(output, asset.binary))) {
    console.log(`ripgrep ${RIPGREP_VERSION} already staged in ${output}`)
    return
  }
  const work = join(tmpdir(), `adomnia-ripgrep-${process.pid}`)
  mkdirSync(work, { recursive: true })
  try {
    const archive = await downloadVerified(asset, work)
    const extracted = extract(archive, work, output)
    const binaries = []
    if (process.platform === 'darwin') {
      // The macOS app is universal: merge the two architecture binaries with lipo.
      const other = assets[`darwin-${process.arch === 'arm64' ? 'x64' : 'arm64'}`]
      const otherWork = join(work, 'other')
      mkdirSync(otherWork, { recursive: true })
      const otherArchive = await downloadVerified(other, otherWork)
      const otherFolder = extract(otherArchive, otherWork, otherWork)
      execFileSync('lipo', ['-create', '-output', join(output, asset.binary), join(extracted, asset.binary), join(otherFolder, other.binary)], { stdio: 'inherit' })
      copyLicenses(extracted, output)
    } else {
      execFileSync('cp', ['-f', join(extracted, asset.binary), join(output, asset.binary)])
      copyLicenses(extracted, output)
      execFileSync('chmod', ['755', join(output, asset.binary)])
    }
    writeFileSync(marker, `${RIPGREP_VERSION}\n`)
    console.log(`ripgrep ${RIPGREP_VERSION} staged in ${output}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`fetch-ripgrep: ${error.message}`)
  if (required) process.exit(1)
  console.error('fetch-ripgrep: continuing without a bundled ripgrep (Go engine fallback)')
})
