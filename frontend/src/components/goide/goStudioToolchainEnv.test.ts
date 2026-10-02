import { describe, expect, it } from 'vitest'
import { corporateNetworkOf, modulePatternProblem, networkModeOf, proxyProblem, suggestedPrivatePattern, toolchainEnvFromForm, toolchainFormFromEnv, withCorporateNetwork, withNetworkMode } from './goStudioToolchainEnv'

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

describe('GOPRIVATE helpers', () => {
  it('validates comma-separated module path patterns', () => {
    expect(modulePatternProblem('GOPRIVATE', 'git.corp.example/*,github.com/acme/*')).toBeNull()
    expect(modulePatternProblem('GOPRIVATE', '')).toBeNull()
    expect(modulePatternProblem('GOPRIVATE', 'a.com/x,,b.com')).toMatch(/empty entry/)
    expect(modulePatternProblem('GONOSUMDB', 'a.com/x b.com')).toMatch(/spaces/)
    expect(modulePatternProblem('GOPRIVATE', 'https://git.corp.example')).toMatch(/URL/)
    expect(modulePatternProblem('GONOPROXY', 'user:token@git.corp.example')).toMatch(/credentials/)
    expect(modulePatternProblem('GOPROXY', 'https://proxy.golang.org,direct')).toBeNull()
  })
  it('suggests the organisation or the corporate host', () => {
    expect(suggestedPrivatePattern('github.com/acme/billing/v2')).toBe('github.com/acme/*')
    expect(suggestedPrivatePattern('git.corp.example/team/svc')).toBe('git.corp.example')
    expect(suggestedPrivatePattern('golang.org/x/tools')).toBeNull()
    expect(suggestedPrivatePattern('example')).toBeNull()
  })
})

describe('network mode', () => {
  it('switches between online, offline and air-gapped without losing other settings', () => {
    const base = toolchainFormFromEnv({ GOPRIVATE: 'git.corp/*', GOFLAGS: '-tags=e2e' })
    expect(networkModeOf(base)).toBe('online')
    const offline = withNetworkMode(base, 'offline')
    expect(toolchainEnvFromForm(offline)).toEqual({ GOPRIVATE: 'git.corp/*', GOFLAGS: '-tags=e2e', GOPROXY: 'off', GOTOOLCHAIN: 'local' })
    expect(networkModeOf(offline)).toBe('offline')
    const airgapped = withNetworkMode(offline, 'airgapped')
    expect(networkModeOf(airgapped)).toBe('airgapped')
    expect(toolchainEnvFromForm(withNetworkMode(airgapped, 'offline')).GOSUMDB).toBeUndefined()
    const online = toolchainEnvFromForm(withNetworkMode(airgapped, 'online'))
    expect(online).toEqual({ GOPRIVATE: 'git.corp/*', GOFLAGS: '-tags=e2e', GOTOOLCHAIN: 'local' })
  })
})

describe('corporate network', () => {
  it('maps proxy, NO_PROXY and CA bundle to the standard variables', () => {
    const form = withCorporateNetwork(toolchainFormFromEnv({ GOPRIVATE: 'git.corp/*' }), { proxy: ' http://proxy.corp:8080 ', noProxy: 'git.corp,localhost', caBundle: 'C:/certs/corp.pem' })
    expect(toolchainEnvFromForm(form)).toEqual({ GOPRIVATE: 'git.corp/*', HTTPS_PROXY: 'http://proxy.corp:8080', HTTP_PROXY: 'http://proxy.corp:8080', NO_PROXY: 'git.corp,localhost', SSL_CERT_FILE: 'C:/certs/corp.pem', GIT_SSL_CAINFO: 'C:/certs/corp.pem' })
    expect(corporateNetworkOf(form)).toEqual({ proxy: 'http://proxy.corp:8080', noProxy: 'git.corp,localhost', caBundle: 'C:/certs/corp.pem' })
    expect(toolchainEnvFromForm(withCorporateNetwork(form, { proxy: '', noProxy: '', caBundle: '' }))).toEqual({ GOPRIVATE: 'git.corp/*' })
  })
  it('validates the proxy URL', () => {
    expect(proxyProblem('http://proxy.corp:8080')).toBeNull()
    expect(proxyProblem('proxy.corp:8080')).not.toBeNull()
    expect(proxyProblem('ftp://proxy')).not.toBeNull()
  })
})
