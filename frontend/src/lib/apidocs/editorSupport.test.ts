import { describe, expect, it } from 'vitest'
import {
  STARTER_SPEC, convertSpec, detectLanguage, formatSpec, parseSpecForEditor,
} from './editorSupport'

describe('editorSupport', () => {
  it('parses the starter spec and includes the OpenAPI 3.2 QUERY operation', () => {
    const { model, error } = parseSpecForEditor(STARTER_SPEC, 'yaml')
    expect(error).toBeUndefined()
    expect(model).toBeDefined()
    const methods = model!.tags.flatMap((t) => t.operations.map((o) => o.method))
    expect(methods).toContain('QUERY')
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
  })

  it('reports the offending line for broken YAML', () => {
    const broken = 'openapi: 3.1.0\ninfo:\n  title: x\n    bad: indent\n'
    const { error } = parseSpecForEditor(broken, 'yaml')
    expect(error).toBeDefined()
    expect(error!.line).toBeGreaterThan(1)
  })

  it('reports the offending line for broken JSON', () => {
    const broken = '{\n  "openapi": "3.1.0",\n  "info": { "title": }\n}'
    const { error } = parseSpecForEditor(broken, 'json')
    expect(error).toBeDefined()
    expect(error!.line).toBeGreaterThanOrEqual(1)
  })

  it('round-trips YAML <-> JSON without losing operations', () => {
    const json = convertSpec(STARTER_SPEC, 'yaml', 'json')
    expect(detectLanguage(json)).toBe('json')
    const back = convertSpec(json, 'json', 'yaml')
    const { model } = parseSpecForEditor(back, 'yaml')
    expect(model!.operationCount).toBe(3)
  })

  it('formats JSON deterministically', () => {
    const ugly = '{"openapi":"3.1.0","info":{"title":"x","version":"1"}}'
    const pretty = formatSpec(ugly, 'json')
    expect(pretty).toContain('\n  "openapi"')
    expect(formatSpec(pretty, 'json')).toBe(pretty)
  })
})
