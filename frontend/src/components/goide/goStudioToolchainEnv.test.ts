import { describe, expect, it } from 'vitest'
import { toolchainEnvFromForm, toolchainFormFromEnv } from './goStudioToolchainEnv'

describe('toolchain env form', () => {
  it('round-trips structured fields, build tags and extra variables', () => {
    const env = { GOPROXY: 'https://proxy.golang.org,direct', CGO_ENABLED: '0', GOFLAGS: '-mod=mod -tags=integration,e2e', GOROOT: '/sdk', GOTOOLCHAIN: 'local' }
    const form = toolchainFormFromEnv(env)
    expect(form.buildTags).toBe('integration,e2e')
    expect(form.goflags).toBe('-mod=mod')
    expect(form.other).toContain('GOTOOLCHAIN=local')
    expect(toolchainEnvFromForm(form)).toEqual(env)
  })

  it('drops empty fields and normalizes tag separators', () => {
    const form = toolchainFormFromEnv({})
    form.buildTags = 'a b,  c'
    expect(toolchainEnvFromForm(form)).toEqual({ GOFLAGS: '-tags=a,b,c' })
  })
})
