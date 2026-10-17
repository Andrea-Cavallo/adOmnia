import { describe,expect,it } from 'vitest'
import { remoteLogLocations } from './remoteLogSource'
describe('remote log source mapping',() => {
 it('maps container prefixes and Windows paths to indexed project files',() => {
  expect(remoteLogLocations('panic at /app/src/main.go:42 +0x1', ['src/main.go'])).toMatchObject([{file:'src/main.go',line:42}])
  expect(remoteLogLocations('C:\\build\\src\\main.go:9:2',['src/main.go'])).toMatchObject([{file:'src/main.go',line:9}])
 })
 it('leaves ambiguous, external and missing sources unlinked',() => {
  expect(remoteLogLocations('main.go:9',['a/main.go','b/main.go'])).toEqual([])
  expect(remoteLogLocations('/usr/local/go/runtime/panic.go:42',['src/main.go'])).toEqual([])
  expect(remoteLogLocations('main.go:0',['main.go'])).toEqual([])
 })
 it('returns correct spans for multiple locations without changing log text',() => {
  const text = 'main.go:9 then foo.go:2'
  const links = remoteLogLocations(text,['main.go','foo.go'])
  expect(links.map(link => text.slice(link.start,link.end))).toEqual(['main.go:9','foo.go:2'])
 })
})
