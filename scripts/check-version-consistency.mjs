#!/usr/bin/env node
// The app version is declared in more than one file: the Wails build config, both
// npm manifests and their lockfiles. A release that updates only some of them ships
// a binary whose About window, installer and update manifest disagree — the exact
// class of drift that let a v0.1.24 tag publish the wrong download.
//
// Usage: node scripts/check-version-consistency.mjs
// Exits non-zero when the declarations do not all state the same x.y.z version.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

// Indented `version:` key of the `info:` block: build/config.yml also has a top-level
// `version: '3'` (the config format), which a `^\s+` pattern swallows on CRLF checkouts.
const CONFIG_VERSION = /^[ \t]+version:[ \t]*['"]?([^'"\s]+)/m

function jsonVersions(root, file) {
  const parsed = JSON.parse(readFileSync(join(root, file), 'utf8'))
  const versions = { [file]: parsed.version }
  // A lockfile repeats the root manifest version in packages[""]; a manifest has no packages.
  if (parsed.packages) versions[`${file} packages[""]`] = parsed.packages['']?.version
  return versions
}

/**
 * Every version declaration in the repository, keyed by file (and nesting) so a
 * mismatch names the file that has to change. Missing values stay in the map as
 * undefined so they are reported instead of skipped.
 */
export function declaredVersions(root) {
  const config = readFileSync(join(root, 'build/config.yml'), 'utf8').match(CONFIG_VERSION)
  return {
    ...jsonVersions(root, 'package.json'),
    ...jsonVersions(root, 'package-lock.json'),
    ...jsonVersions(root, 'frontend/package.json'),
    ...jsonVersions(root, 'frontend/package-lock.json'),
    'build/config.yml': config ? config[1] : undefined,
  }
}

/**
 * The reasons the declarations are not release-ready: an empty array means every
 * source states the same well-formed version.
 */
export function versionConsistencyProblems(versions) {
  const problems = []
  const entries = Object.entries(versions)
  for (const [file, version] of entries) {
    if (!version) problems.push(`${file} does not declare a version`)
    else if (!VERSION_PATTERN.test(version)) problems.push(`${file} declares ${version}, which is not x.y.z`)
  }
  const distinct = new Set(entries.map(([, version]) => version).filter(Boolean))
  if (distinct.size > 1) {
    problems.push(`version sources disagree (${[...distinct].join(', ')}): update every source to the same version before tagging`)
  }
  return problems
}

function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const versions = declaredVersions(root)
  const problems = versionConsistencyProblems(versions)
  if (problems.length) {
    console.error('check-version-consistency: the repository declares different app versions')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  const [version] = new Set(Object.values(versions))
  console.log(`check-version-consistency: ${version} is declared identically in ${Object.keys(versions).length} places`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
