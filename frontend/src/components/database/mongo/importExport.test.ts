import { describe, expect, it } from 'vitest'
import { parseImportFile } from './importExport'

describe('parseImportFile', () => {
  it('reads JSON arrays and NDJSON', () => {
    expect(parseImportFile('a.json', '[{"a":1},{"b":{"$oid":"65a1b2c3d4e5f60718293a4b"}}]')).toHaveLength(2)
    expect(parseImportFile('a.ndjson', '{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }])
    expect(() => parseImportFile('a.json', '{"a":')).toThrow()
  })

  it('reads CSV with types, quotes and dotted headers', () => {
    const docs = parseImportFile('a.csv', 'name,age,active,address.zip,note\r\n"Rossi, Ada",36,true,00100,"say ""hi"""\nBob,,false,20100,\n')
    expect(docs).toEqual([
      { name: 'Rossi, Ada', age: 36, active: true, address: { zip: '00100' }, note: 'say "hi"' },
      { name: 'Bob', active: false, address: { zip: 20100 } },
    ])
  })
})
