import { describe, expect, it } from 'vitest'
import { prepareJsonEnvironmentExtraction } from './jsonTemplateValues'

describe('prepareJsonEnvironmentExtraction', () => {
  it('stores a full JSON string without its JSON quotes', () => {
    expect(prepareJsonEnvironmentExtraction('"Mario Rossi"', '{{NAME}}')).toEqual({
      value: 'Mario Rossi',
      replacement: '"{{NAME}}"',
    })
  })

  it('decodes JSON escapes before saving a full string', () => {
    expect(prepareJsonEnvironmentExtraction('"A \\"quoted\\" value"', '{{LABEL}}')).toEqual({
      value: 'A "quoted" value',
      replacement: '"{{LABEL}}"',
    })
  })

  it.each([
    ['0', '{{PRICE}}'],
    ['12.5', '{{PRICE}}'],
    ['true', '{{ENABLED}}'],
    ['false', '{{ENABLED}}'],
    ['null', '{{OPTIONAL}}'],
  ])('keeps the JSON literal %s unquoted', (selection, replacement) => {
    expect(prepareJsonEnvironmentExtraction(selection, replacement)).toEqual({
      value: selection,
      replacement,
    })
  })
})
