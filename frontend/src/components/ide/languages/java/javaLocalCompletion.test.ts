import { describe, expect, it } from 'vitest'
import { completeLocalJava } from './javaLocalCompletion'
import { javaOutline } from './javaLocalOutline'
describe('Java completion without a server',()=>{
 it('offers file names, constants, keywords and snippets once',()=>{
  const text='class Demo { static final int LIMIT=42; void run(int input) { int local=1; loc } }'
  const result=completeLocalJava(text,text.indexOf(' loc }')+4)
  expect(result.map(x=>x.label)).toEqual(expect.arrayContaining(['local','input','LIMIT','return','sout']))
  expect(result.find(x=>x.label==='LIMIT')?.kind).toBe('Constant')
  expect(new Set(result.map(x=>x.label)).size).toBe(result.length)
 })
 it('suppresses comments, unfinished strings and unknown member completion',()=>{
  for(const text of ['class A { // return ', 'class A { String s = "unfinished', 'class A { void f(){ unknown.']) expect(completeLocalJava(text,text.length)).toEqual([])
 })
 it('suggests only declared members after this',()=>{
  const text='class A { int field; void run(int input) { int local=1; this. } }'
  const names=completeLocalJava(text,text.indexOf('this.')+5).map(x=>x.label)
  expect(names).toEqual(expect.arrayContaining(['field','run']))
  expect(names).not.toContain('local'); expect(names).not.toContain('return')
 })
})
describe('Java outline handover',()=>{
 const buffer='class Local { void edited() {} }'
 const remote= [{name:'Remote',kind:5,range:{startLine:1,startColumn:1,endLine:1,endColumn:9},selectionRange:{startLine:1,startColumn:1,endLine:1,endColumn:7}}]
 it.each(['stopped','missing','starting','crashed'])('uses the current buffer while JDT is %s',state=>{
  expect(javaOutline(buffer,state,remote).symbols[0].name).toBe('Local')
 })
 it('prefers current JDT symbols, rejects old buffers and keeps local on empty import results',()=>{
  expect(javaOutline(buffer,'ready',remote,buffer).source).toBe('server')
  expect(javaOutline(buffer,'ready',remote,'old').symbols[0].name).toBe('Local')
  expect(javaOutline(buffer,'ready',[]).symbols[0].name).toBe('Local')
 })
})
