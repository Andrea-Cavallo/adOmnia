#!/usr/bin/env node
// Refuses a release tag that would ship the wrong version. The tag becomes the
// app version, the installer and update manifest version, and GitHub marks the
// most recently published release as "Latest" whatever its number: a mistyped
// tag (v0.1.24 pushed after v1.0.24) became the download every user got.
//
// Usage: node scripts/check-release-version.mjs <tag>
// The tag must be v<major>.<minor>.<patch>[-prerelease], match the version the
// repository declares (frontend/package.json, build/config.yml) and be higher
// than every release tag already on the remote.
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { declaredVersions as repositoryVersions, versionConsistencyProblems } from './check-version-consistency.mjs'

const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** Parses v1.2.3[-pre] into comparable parts, or null. */
export function parseTag(tag) {
  const match = TAG_PATTERN.exec(tag)
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ?? '' }
}

function comparePrerelease(a, b) {
  if (a === b) return 0
  if (!a) return 1 // a stable release is higher than its prereleases
  if (!b) return -1
  const left = a.split('.')
  const right = b.split('.')
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1
    if (right[i] === undefined) return 1
    const numeric = /^\d+$/.test(left[i]) && /^\d+$/.test(right[i])
    const order = numeric ? Number(left[i]) - Number(right[i]) : left[i].localeCompare(right[i])
    if (order !== 0) return Math.sign(order)
  }
  return 0
}

/** Semantic version order of two parsed tags. */
export function compareTags(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return Math.sign(a.core[i] - b.core[i])
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * Every reason the tag must not be released, empty when it is fine.
 * declared: the versions the repository files state; existingTags: tags on the remote.
 */
export function releaseVersionProblems({ tag, declared, existingTags }) {
  const parsed = parseTag(tag)
  if (!parsed) return [`${tag} is not v<major>.<minor>.<patch>[-prerelease]`]
  const problems = []
  const version = tag.slice(1)
  const core = parsed.core.join('.')
  for (const [file, value] of Object.entries(declared)) {
    // A prerelease tag (v1.1.0-rc.1) may come from a tree that already declares 1.1.0.
    if (value !== version && !(parsed.prerelease && value === core)) {
      problems.push(`${file} declares ${value}, the tag says ${version}`)
    }
  }
  const highest = existingTags
    .filter((other) => other !== tag && parseTag(other))
    .reduce((best, other) => (!best || compareTags(parseTag(other), parseTag(best)) > 0 ? other : best), '')
  if (highest && compareTags(parseTag(highest), parsed) >= 0) {
    problems.push(`${highest} already exists and is not lower than ${tag}: GitHub would mark ${tag} as Latest`)
  }
  return problems
}

export function declaredVersions(root) {
  return repositoryVersions(root)
}

function remoteTags(root) {
  const output = execFileSync('git', ['ls-remote', '--tags', '--refs', 'origin'], { cwd: root, encoding: 'utf8' })
  return output.split('\n').map((line) => line.split('refs/tags/')[1]).filter(Boolean)
}

function main() {
  const tag = process.argv[2]
  if (!tag) {
    console.error('usage: node scripts/check-release-version.mjs <tag>')
    process.exit(2)
  }
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const declared = declaredVersions(root)
  // A tag that matches one source while another one drifted must still be refused.
  const problems = [
    ...versionConsistencyProblems(declared),
    ...releaseVersionProblems({ tag, declared, existingTags: remoteTags(root) }),
  ]
  if (problems.length) {
    console.error(`check-release-version: ${tag} must not be released`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`check-release-version: ${tag} matches the repository and is the highest release`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
