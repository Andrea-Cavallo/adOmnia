import { describe, expect, it } from 'vitest'
import { analyzeJavaFile, localJavaCompletions } from './javaLocalAnalysis'
const source = `package demo;
class Outer {
 static final int LIMIT = 42;
 String field;
 Outer(String name) { this.field = name; }
 int work(int input) {
  int count = input;
  { String count = "inner"; count.length(); }
  return count;
 }
 int work(String input) { return 0; }
 record Inner(String value) { int size() { return value.length(); } }
}`
const at = (text: string, needle: string) => text.indexOf(needle)
describe('local Java syntax', () => {
 it('builds nested types, fields, constructors and distinct overloads', () => {
  const analysis = analyzeJavaFile(source)
  const outer = analysis.symbols[0]
  expect(outer.name).toBe('Outer')
  expect(outer.children?.map(x => x.name)).toEqual(expect.arrayContaining(['LIMIT','field','Outer','work','Inner']))
  expect(outer.children?.filter(x => x.name === 'work').map(x => x.detail)).toEqual(['(int input)', '(String input)'])
  expect(outer.children?.find(x => x.name === 'Inner')?.children?.map(x => x.name)).toContain('size')
 })
 it('respects local scopes, declaration order and shadowing', () => {
  const inside = localJavaCompletions(analyzeJavaFile(source), at(source,'count.length'))
  expect(inside.find(x=>x.name==='count')?.detail).toContain('String')
  const outside = localJavaCompletions(analyzeJavaFile(source), at(source,'return count'))
  expect(outside.find(x=>x.name==='count')?.detail).toContain('int')
  expect(outside.some(x=>x.name==='input')).toBe(true)
  expect(localJavaCompletions(analyzeJavaFile(source), at(source,'int count')).some(x=>x.name==='count')).toBe(false)
 })
 it('ignores comments, strings and text blocks and suppresses their completions', () => {
  const text = 'class A { /* class Fake {} */ String s = "class Ghost {}"; String t = """\nclass Nope {}\n"""; }'
  const analysis = analyzeJavaFile(text)
  expect(analysis.symbols.map(x=>x.name)).toEqual(['A'])
  expect(localJavaCompletions(analysis, text.indexOf('Ghost'))).toEqual([])
  expect(localJavaCompletions(analysis, text.indexOf('Fake'))).toEqual([])
 })
 it('keeps incomplete declarations and UTF-16 positions', () => {
  const text = '// 😀\nclass Café {\n void run(String value) {\n int unfinished ='
  const analysis = analyzeJavaFile(text)
  expect(analysis.symbols[0].selectionRange).toMatchObject({startLine:2,startColumn:7})
  expect(analysis.symbols[0].children?.some(x=>x.name==='run')).toBe(true)
  expect(localJavaCompletions(analysis,text.length).some(x=>x.name==='value')).toBe(true)
 })
})

describe('Java local edge cases', () => {
 it('keeps generic/array/varargs declarations and enum constants', () => {
  const text = 'class A { java.util.Map<String, java.util.List<Integer>> items; String[] names; void add(String... values) { int left = 0, right = 1; System.out.println(right); } } enum Mode { ON, OFF; }'
  const result = analyzeJavaFile(text)
  expect(result.symbols[0].children?.find(x=>x.name==='items')?.detail).toContain('Map<String')
  expect(result.symbols[1].children?.map(x=>x.name)).toEqual(['ON','OFF'])
  const visible=localJavaCompletions(result,text.indexOf('System.out'))
  expect(visible.map(x=>x.name)).toEqual(expect.arrayContaining(['values','left','right','names']))
 })
 it('keeps lambda parameters inside their body and does not invent callable symbols', () => {
  const text = 'class A { void run() { var fn = (String value) -> { int count = 1; consume(value); }; consume(other); } }'
  const result=analyzeJavaFile(text)
  expect(localJavaCompletions(result,text.indexOf('consume(value)')).some(x=>x.name==='value')).toBe(true)
  expect(localJavaCompletions(result,text.indexOf('consume(other)')).some(x=>x.name==='value')).toBe(false)
  expect(result.symbols[0].children?.map(x=>x.name)).toEqual(['run'])
 })
 it('nests anonymous-class methods without treating calls as declarations', () => {
  const text='class A { Runnable task = new Runnable() { public void run() { inner(deepest()); } }; }'
  const result=analyzeJavaFile(text)
  const anonymous=result.symbols[0].children?.find(x=>x.name.includes('anonymous'))
  expect(anonymous?.children?.map(x=>x.name)).toEqual(['run'])
 })
 it('does not expose locals from another method or another file', () => {
  const first='class A { void one() { int hidden=1; } void two() { consume(); } }'
  expect(localJavaCompletions(analyzeJavaFile(first),first.indexOf('consume()')).some(x=>x.name==='hidden')).toBe(false)
  const second='class B { void run() { consume(); } }'
  expect(localJavaCompletions(analyzeJavaFile(second),second.indexOf('consume()')).some(x=>x.name==='hidden')).toBe(false)
 })
 it('bounds huge files rather than partially reporting invented structure', () => {
  const result=analyzeJavaFile(' '.repeat(256001))
  expect(result.limited).toBe(true)
  expect(result.symbols).toEqual([])
 })
})

it('keeps Spring-style annotated methods and does not turn interface parameters into fields',()=>{
 const text='interface Api { String load(String id); } class Controller { @GetMapping(value = "/x") String handle(int page) { return "ok"; } }'
 const result=analyzeJavaFile(text)
 expect(result.symbols[0].children?.map(x=>x.name)).toEqual(['load'])
 expect(result.symbols[1].children?.map(x=>x.name)).toContain('handle')
})
