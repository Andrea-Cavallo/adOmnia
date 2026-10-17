import assert from 'node:assert/strict'
import { test } from 'node:test'
import { greet } from './greet.js'

test('greet says hello', () => {
  assert.equal(greet('Ada'), 'Hello, Ada!')
})
