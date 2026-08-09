import { describe, expect, it } from 'vitest'
import { parseInteropFile } from '@/lib/interopHub'

describe('env.yaml import', () => {
  it('imports named environments and classifies secret variables', () => {
    const bundle = parseInteropFile('env.yaml', `
environments:
  local:
    BASE_URL: http://localhost:8080
    API_TOKEN: local-token
  production:
    variables:
      BASE_URL: https://api.example.test
      TIMEOUT_MS: 5000
`)

    expect(bundle.format).toBe('env-yaml')
    expect(bundle.environments.map((environment) => environment.name)).toEqual(['local', 'production'])
    expect(bundle.environments[0].variables).toMatchObject([
      { key: 'BASE_URL', value: 'http://localhost:8080', type: 'text' },
      { key: 'API_TOKEN', value: 'local-token', type: 'secret' },
    ])
  })

  it('does not treat arbitrary YAML filenames as environments', () => {
    expect(() => parseInteropFile('openapi.yaml', 'service: api')).toThrow()
  })
})
