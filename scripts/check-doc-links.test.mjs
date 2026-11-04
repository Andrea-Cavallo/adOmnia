import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brokenLinks, linkTargets } from './check-doc-links.mjs'

const tracked = new Set(['README.md', 'docs/GUIDE.md', 'assets/shot.png', 'docs/with space.png'])

test('accepts a link to a tracked file, relative to the Markdown file', () => {
  assert.deepEqual(brokenLinks({ file: 'docs/GUIDE.md', markdown: '[guide](../README.md)', tracked }), [])
  assert.deepEqual(brokenLinks({ file: 'README.md', markdown: '![shot](assets/shot.png)', tracked }), [])
})

test('reports a link to a file a clone does not have, with the resolved path', () => {
  const [broken] = brokenLinks({ file: 'docs/GUIDE.md', markdown: '[notes](../mds/FIX.md)', tracked })
  assert.equal(broken.resolved, 'mds/FIX.md')
  assert.equal(broken.target, '../mds/FIX.md')
})

test('ignores external URLs, in-page anchors and image links in code', () => {
  const markdown = [
    '[site](https://github.com/Andrea-Cavallo/adOmnia)',
    '[section](#the-section)',
    '`![](img/a.png)` is an example',
    '```md',
    '![](relative/path.png)',
    '```',
  ].join('\n')
  assert.deepEqual(linkTargets(markdown), ['https://github.com/Andrea-Cavallo/adOmnia', '#the-section'])
  assert.deepEqual(brokenLinks({ file: 'README.md', markdown, tracked }), [])
})

test('decodes percent-encoded targets and reads reference definitions', () => {
  const markdown = '[shot](<docs/with%20space.png>)\n\n[def]: docs/GUIDE.md'
  assert.deepEqual(brokenLinks({ file: 'README.md', markdown, tracked }), [])
})
