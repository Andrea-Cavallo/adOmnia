import { describe,expect,it } from 'vitest'
import { extensionResult } from './extensionResult'
describe('IDE extension API result',() => {
 it('preserves a proposed buffer and maps bounded diagnostics',() => {
  expect(extensionResult({text:'new code',diagnostics:[{line:2,message:'problem',severity:1}]})).toEqual({text:'new code',message:undefined,diagnostics:[{line:2,column:1,endLine:2,endColumn:2,message:'problem',severity:1}]})
 })
 it('rejects malformed diagnostics and oversized replacement buffers',() => {
  expect(() => extensionResult({diagnostics:[{line:0,message:'wrong'}]})).toThrow()
  expect(() => extensionResult({text:'漢'.repeat(400000)})).toThrow()
  expect(() => extensionResult('execute this')).toThrow()
 })
 it('limits diagnostics and never treats plugin fields as filesystem actions',() => {
  const parsed = extensionResult({diagnostics:Array.from({length:1000},()=>({line:1,message:'x'})),files:[{path:'../secret',text:'overwrite'}]})
  expect(parsed.diagnostics).toHaveLength(500)
  expect(parsed).not.toHaveProperty('files')
 })
})
