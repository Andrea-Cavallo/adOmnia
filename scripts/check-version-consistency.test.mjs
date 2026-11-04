import { test } from 'node:test'
import assert from 'node:assert/strict'
import { versionConsistencyProblems } from './check-version-consistency.mjs'

const consistent = {
  'package.json': '1.0.24',
  'package-lock.json': '1.0.24',
  'frontend/package.json': '1.0.24',
  'frontend/package-lock.json': '1.0.24',
  'build/config.yml': '1.0.24',
}

test('accepts a repository where every source states the same version', () => {
  assert.deepEqual(versionConsistencyProblems(consistent), [])
})

test('names the source that drifted after a partial version bump', () => {
  const problems = versionConsistencyProblems({ ...consistent, 'build/config.yml': '1.0.23' })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /disagree/)
  assert.doesNotMatch(problems[0], /missing/)
})

test('reports missing and malformed declarations instead of skipping them', () => {
  const problems = versionConsistencyProblems({ ...consistent, 'frontend/package-lock.json': undefined })
  assert.match(problems[0], /frontend\/package-lock\.json does not declare a version/)
  assert.match(versionConsistencyProblems({ ...consistent, 'package.json': 'v1.0.24' })[0], /not x\.y\.z/)
})
