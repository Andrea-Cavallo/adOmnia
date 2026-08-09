import { describe, expect, it } from 'vitest'
import { diagnoseJson } from './jsonDiagnostics'

describe('diagnoseJson', () => {
  it('accepts environment variables across JSON value types', () => {
    expect(diagnoseJson(`{
      "price": {{PRICE}},
      "enabled": {{ENABLED}},
      "disabled": {{DISABLED}},
      "optional": {{OPTIONAL}},
      "name": "{{NAME}}"
    }`)).toEqual([])
  })

  it('still reports real JSON errors beside a variable value', () => {
    expect(diagnoseJson('{\n  "price": {{PRICE}},\n}')).not.toEqual([])
  })
})
