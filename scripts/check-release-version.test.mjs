import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareTags, parseTag, releaseVersionProblems } from './check-release-version.mjs'

const declared = { 'frontend/package.json': '1.0.24', 'build/config.yml': '1.0.24' }

test('accepts the next release declared by the repository', () => {
  assert.deepEqual(releaseVersionProblems({ tag: 'v1.0.24', declared, existingTags: ['v1.0.23', 'v1.0.9', 'v0.9.73'] }), [])
})

test('refuses the mistyped v0.1.24 pushed after v1.0.24', () => {
  const problems = releaseVersionProblems({ tag: 'v0.1.24', declared, existingTags: ['v1.0.24', 'v1.0.23'] })
  assert.equal(problems.length, 3)
  assert.match(problems.join('\n'), /declares 1\.0\.24, the tag says 0\.1\.24/)
  assert.match(problems.join('\n'), /v1\.0\.24 already exists/)
})

test('refuses a tag the repository does not declare, or a malformed one', () => {
  assert.match(releaseVersionProblems({ tag: 'v1.0.25', declared, existingTags: [] })[0], /declares 1\.0\.24/)
  assert.match(releaseVersionProblems({ tag: '1.0.24', declared, existingTags: [] })[0], /is not v<major>/)
})

test('a prerelease may come from a tree declaring its final version', () => {
  const next = { 'frontend/package.json': '1.1.0', 'build/config.yml': '1.1.0' }
  assert.deepEqual(releaseVersionProblems({ tag: 'v1.1.0-rc.1', declared: next, existingTags: ['v1.0.24'] }), [])
  assert.equal(releaseVersionProblems({ tag: 'v1.1.0-rc.1', declared: next, existingTags: ['v1.1.0'] }).length, 1)
})

test('orders versions numerically and prereleases below their release', () => {
  const order = ['v0.9.73', 'v1.0.9', 'v1.0.10', 'v1.1.0-beta.2', 'v1.1.0-beta.10', 'v1.1.0-rc.1', 'v1.1.0']
  for (let i = 1; i < order.length; i++) assert.equal(compareTags(parseTag(order[i - 1]), parseTag(order[i])), -1, `${order[i - 1]} < ${order[i]}`)
})
