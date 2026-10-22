#!/usr/bin/env node
// Keeps one Wails version across go.mod, docs and CI. The CLI installed by each
// workflow must match the module the app compiles against, and the docs must not
// advertise a different one to contributors.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (relative) => readFileSync(join(root, relative), 'utf8')
const wailsVersionPattern = /v3\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g

function versionsIn(text) {
  return [...new Set(text.match(wailsVersionPattern) ?? [])]
}

const goMod = read('go.mod')
const moduleMatch = goMod.match(/github\.com\/wailsapp\/wails\/v3\s+(v\S+)/)
if (!moduleMatch) {
  console.error('check-wails-version: cannot find github.com/wailsapp/wails/v3 in go.mod')
  process.exit(1)
}
const expected = moduleMatch[1]
const problems = []

function expectEveryVersion(relative, { requireAny = false } = {}) {
  const found = versionsIn(read(relative))
  if (requireAny && found.length === 0) {
    problems.push(`${relative}: no Wails version found; expected ${expected}`)
    return
  }
  for (const version of found) {
    if (version !== expected) problems.push(`${relative}: ${version} (expected ${expected})`)
  }
}

for (const file of ['docs/BUILD.md', 'README.md', 'AGENTS.md']) expectEveryVersion(file)

const workflowFiles = [
  '.github/workflows/build.yml',
  '.github/workflows/release.yml',
  '.github/workflows/release-compress.yml',
  '.github/workflows/packaging.yml',
  '.github/workflows/website-sync.yml',
]
for (const file of workflowFiles) {
  const text = read(file)
  const declared = [...text.matchAll(/WAILS_VERSION:\s*(\S+)/g)].map((match) => match[1].replace(/['"]/g, ''))
  for (const version of declared) {
    if (version !== expected) problems.push(`${file}: WAILS_VERSION=${version} (expected ${expected})`)
  }
  for (const version of versionsIn(text)) {
    // Workflow comments may name another version while explaining a migration;
    // only the executable env declaration is authoritative.
    if (!text.includes(`WAILS_VERSION: ${version}`) && version !== expected) {
      problems.push(`${file}: ${version} (expected ${expected})`)
    }
  }
}

if (problems.length) {
  console.error(`check-wails-version: go.mod pins ${expected}`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`check-wails-version: ${expected} is consistent in go.mod, docs and workflows`)
