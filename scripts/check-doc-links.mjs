#!/usr/bin/env node
// Published Markdown must not link to files a clone does not have. Local planning
// documents (`mds/*`) exist on the author's machine but are not tracked, so a link to
// them looks fine locally and is broken for everyone reading the repository.
//
// Usage: node scripts/check-doc-links.mjs
// Every link target is resolved against the files git tracks, not against the working
// tree: that is what a reader actually gets. External URLs and in-page anchors are
// ignored. Exits non-zero when a link points at a missing or untracked file.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIPPED_SCHEME = /^(?:[a-z][a-z0-9+.-]*:|#)/i
const FENCE = /^\s*(```|~~~)/
const INLINE_LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*(\S+)/

function gitList(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
}

/** Link targets in one file, skipping fenced code blocks where `[...](...)` is not a link. */
export function linkTargets(markdown) {
  const targets = []
  let inFence = false
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    // Inline code shows a link as an example: `![](relative/path.png)` is not a link.
    for (const match of line.replace(/`[^`]*`/g, '').matchAll(INLINE_LINK)) targets.push(match[1])
    const definition = REFERENCE_DEFINITION.exec(line)
    if (definition) targets.push(definition[1])
  }
  return targets
}

/**
 * The links that do not resolve to a tracked file. `file` is the Markdown file's
 * repository-relative POSIX path; `tracked` holds every tracked path.
 */
export function brokenLinks({ file, markdown, tracked }) {
  const broken = []
  for (const raw of linkTargets(markdown)) {
    if (SKIPPED_SCHEME.test(raw)) continue
    const target = raw.startsWith('<') ? raw.slice(1, -1) : raw
    const path = decodeURIComponent(target.split('#')[0].split('?')[0])
    if (!path) continue
    const resolved = path.startsWith('/')
      ? posix.normalize(path.slice(1))
      : posix.normalize(posix.join(posix.dirname(file), path))
    if (!tracked.has(resolved)) broken.push({ file, target: raw, resolved })
  }
  return broken
}

function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const tracked = new Set(gitList(root, ['ls-files', '-z']))
  const markdownFiles = [...tracked].filter((path) => path.endsWith('.md')).sort()
  const broken = []
  for (const file of markdownFiles) {
    const markdown = readFileSync(join(root, file), 'utf8')
    broken.push(...brokenLinks({ file, markdown, tracked }))
  }
  if (broken.length) {
    console.error(`check-doc-links: ${broken.length} link(s) point at files a clone does not have`)
    for (const { file, target, resolved } of broken) console.error(`  ${file}: ${target} (${resolved} is not tracked)`)
    process.exit(1)
  }
  console.log(`check-doc-links: ${markdownFiles.length} Markdown files link only to tracked files`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
