import { describe, expect, it } from 'vitest'
import type { MyBatisLink } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/java/models'
import { mybatisBrokenLinks, mybatisLinkAt, mybatisTarget } from './mybatisLinks'

const linked = { namespace: 'a.M', id: 'find', kind: 'select', state: 'linked', xmlFile: 'src/M.xml', xmlLine: 3, xmlStartColumn: 15, xmlEndColumn: 19, javaFile: 'src/M.java', javaLine: 7, javaStartColumn: 10, javaEndColumn: 14 } as MyBatisLink
const xmlOnly = { namespace: 'a.M', id: 'gone', kind: 'delete', state: 'xmlOnly', xmlFile: 'src/M.xml', xmlLine: 9, xmlStartColumn: 1, xmlEndColumn: 5 } as MyBatisLink

describe('MyBatis links', () => {
  it('finds the statement under the cursor on either side, ignoring path separators and case', () => {
    expect(mybatisLinkAt([linked, xmlOnly], 'src\\m.java', 7, 'java')).toBe(linked)
    expect(mybatisLinkAt([linked, xmlOnly], 'src/M.xml', 9, 'xml')).toBe(xmlOnly)
    expect(mybatisLinkAt([linked], 'src/M.java', 8, 'java')).toBeNull()
  })
  it('navigates to the other half and returns null when it does not exist', () => {
    expect(mybatisTarget(linked, 'java')).toEqual({ file: 'src/M.xml', line: 3, startColumn: 15, endColumn: 19 })
    expect(mybatisTarget(linked, 'xml')).toEqual({ file: 'src/M.java', line: 7, startColumn: 10, endColumn: 14 })
    expect(mybatisTarget(xmlOnly, 'xml')).toBeNull()
  })
  it('reports the links with a missing half', () => {
    expect(mybatisBrokenLinks([linked, xmlOnly])).toEqual([xmlOnly])
  })
})
