#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const generatedDir = path.join(root, 'frontend', 'wailsjs', 'go', 'main')

if (!fs.existsSync(generatedDir)) {
  process.exit(0)
}

for (const entry of fs.readdirSync(generatedDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(js|d\.ts)$/i.test(entry.name)) continue
  const filePath = path.join(generatedDir, entry.name)
  const original = fs.readFileSync(filePath, 'utf8')
  const next = original
    .split(/\r?\n/)
    .filter((line) => !line.includes('Cynhyrchwyd y ffeil hon yn awtomatig'))
    .join('\n')
  if (next !== original) {
    fs.writeFileSync(filePath, next.endsWith('\n') ? next : `${next}\n`, 'utf8')
  }
}
