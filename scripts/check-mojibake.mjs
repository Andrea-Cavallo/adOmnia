#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const skipDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'bin',
  'vendor',
])

const textExtensions = new Set([
  '.css',
  '.go',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.mjs',
  '.ps1',
  '.scss',
  '.sh',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
])

const checks = [
  { label: 'replacement character', pattern: /\uFFFD/u },
  { label: 'UTF-8 decoded as Windows-1252: starts with U+00E2', pattern: /\u00E2/u },
  { label: 'UTF-8 decoded as Windows-1252: starts with U+00C3', pattern: /\u00C3/u },
  { label: 'UTF-8 decoded as Windows-1252: stray U+00C2', pattern: /\u00C2/u },
  { label: 'emoji decoded as Windows-1252: U+00F0 U+0178', pattern: /\u00F0\u0178/u },
]

function isTextFile(filePath) {
  const base = path.basename(filePath)
  return textExtensions.has(path.extname(base).toLowerCase()) || base === 'AGENTS.md' || base === 'CLAUDE.md'
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name), files)
      continue
    }
    const filePath = path.join(dir, entry.name)
    if (entry.isFile() && isTextFile(filePath)) files.push(filePath)
  }
  return files
}

const findings = []

for (const filePath of walk(root)) {
  const rel = path.relative(root, filePath).replaceAll(path.sep, '/')
  const text = fs.readFileSync(filePath, 'utf8')
  const lines = text.split(/\r?\n/)

  lines.forEach((line, index) => {
    const matched = checks.filter((check) => check.pattern.test(line)).map((check) => check.label)
    if (matched.length) {
      findings.push({
        file: rel,
        line: index + 1,
        matched,
        preview: line.trim().slice(0, 180),
      })
    }
  })
}

if (findings.length) {
  console.error(`Mojibake check failed: ${findings.length} suspicious line(s).`)
  for (const finding of findings.slice(0, 100)) {
    console.error(`${finding.file}:${finding.line} ${finding.matched.join(', ')}`)
    console.error(`  ${finding.preview}`)
  }
  if (findings.length > 100) {
    console.error(`  ...and ${findings.length - 100} more.`)
  }
  process.exit(1)
}

console.log('Mojibake check passed.')
