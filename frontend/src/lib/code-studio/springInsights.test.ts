import { describe, expect, it } from 'vitest'
import type {
  SpringBean,
  SpringEndpoint,
  SpringIndex,
  SpringInjection,
  SpringProperty,
  SpringValue,
} from '../../../bindings/adomnia/internal/languages/java/models'
import {
  beanForInjection,
  configProfileOf,
  effectiveValues,
  filterEndpoints,
  isSpringConfigPath,
  locationOfProperty,
  overriddenKeys,
  propertyForValue,
  propertyMarkdown,
  springCompletions,
  typedPropertyKey,
  typedYamlKey,
  valueFor,
} from './springInsights'

const port = { name: 'server.port', type: 'java.lang.Integer', description: 'Server HTTP port.', default: '8080', source: 'metadata', origin: 'org.springframework.boot.web.server.ServerProperties' } as SpringProperty
const address = { name: 'server.address', type: 'java.net.InetAddress', description: 'Network address.', source: 'metadata' } as SpringProperty
const mailHost = { name: 'acme.mail.host', type: 'java.lang.String', description: 'SMTP host.', source: 'project', origin: 'com.acme.demo.MailProperties', file: 'src/main/java/com/acme/demo/MailProperties.java', line: 8, startColumn: 5, endColumn: 39 } as SpringProperty
const serverPortValue = { key: 'server.port', value: '8080', file: 'src/main/resources/application.properties', line: 1, startColumn: 1, endColumn: 12 } as SpringValue
const serverPortProd = { key: 'server.port', value: '80', profile: 'prod', overridesBase: true, file: 'src/main/resources/application-prod.properties', line: 1, startColumn: 1, endColumn: 12 } as SpringValue

function indexWith(parts: Partial<SpringIndex>): SpringIndex {
  return { status: 'ready', properties: [], values: [], propertyReferences: [], diagnostics: [], beans: [], injections: [], endpoints: [], ...parts } as SpringIndex
}

describe('configuration files', () => {
  it('recognizes application.properties and its profiles', () => {
    expect(isSpringConfigPath('src/main/resources/application.properties')).toBe(true)
    expect(isSpringConfigPath('src/main/resources/application-prod.yml')).toBe(true)
    expect(isSpringConfigPath('src/main/resources/application-test.yaml')).toBe(true)
    expect(isSpringConfigPath('src/main/resources/logback-spring.xml')).toBe(false)
    expect(isSpringConfigPath('src/main/resources/application.properties.bak')).toBe(false)
    expect(configProfileOf('src/main/resources/application-prod.properties')).toBe('prod')
    expect(configProfileOf('application.properties')).toBe('')
  })
})

describe('typed keys', () => {
  it('replaces only what has been typed in a properties file', () => {
    expect(typedPropertyKey('server.po', 10)).toEqual({ key: 'server.po', startColumn: 1, endColumn: 10 })
    expect(typedPropertyKey('server.port=', 13)).toEqual({ key: 'server.port', startColumn: 1, endColumn: 12 })
    expect(typedPropertyKey('  acme.', 8)).toEqual({ key: 'acme.', startColumn: 3, endColumn: 8 })
  })

  it('walks the YAML indentation to build the full key', () => {
    const lines = ['spring:', '  datasource:', '    ur', 'server:', '  port: 8080']
    expect(typedYamlKey(lines, 3, 7)).toEqual({ key: 'spring.datasource.ur', startColumn: 5, endColumn: 7 })
    expect(typedYamlKey(lines, 5, 9)).toEqual({ key: 'server.port', startColumn: 3, endColumn: 7 })
    expect(typedYamlKey(['po'], 1, 3).key).toBe('po')
  })
})

describe('completions', () => {
  it('puts the properties sharing the typed prefix first', () => {
    const index = indexWith({ properties: [address, port, mailHost] })
    expect(springCompletions(index, 'server.').map((property) => property.name)).toEqual(['server.address', 'server.port'])
    expect(springCompletions(index, 'server.po').map((property) => property.name)).toEqual(['server.port'])
    expect(springCompletions(index, 'mail').map((property) => property.name)).toEqual(['acme.mail.host'])
    expect(springCompletions(index, '')).toHaveLength(3)
    expect(springCompletions(index, 'nothing')).toHaveLength(0)
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 50 }, (_, position) => ({ name: `k${position}`, type: 'java.lang.String', description: '', source: 'metadata' } as SpringProperty))
    expect(springCompletions(indexWith({ properties: many }), 'k', 10)).toHaveLength(10)
  })
})

describe('values and profiles', () => {
  it('lets the profile win over the base value', () => {
    const effective = effectiveValues(indexWith({ values: [serverPortValue, serverPortProd] }))
    expect(effective.get('server.port')?.value).toBe('80')
  })

  it('reports which keys a profile overrides', () => {
    const index = indexWith({ values: [serverPortValue, serverPortProd] })
    expect(overriddenKeys(index).has('server.port')).toBe(true)
    expect(overriddenKeys(indexWith({ values: [serverPortValue] })).has('server.port')).toBe(false)
  })

  it('finds the value to jump to from a @Value reference', () => {
    const index = indexWith({ values: [serverPortProd, serverPortValue] })
    expect(valueFor(index, 'server.port')?.value).toBe('8080')
  })
})

describe('documentation', () => {
  it('shows type, default, origin and the configured value', () => {
    const markdown = propertyMarkdown(port, effectiveValues(indexWith({ values: [serverPortValue] })))
    expect(markdown).toContain('`server.port`')
    expect(markdown).toContain('Server HTTP port.')
    expect(markdown).toContain('**Type** `java.lang.Integer`')
    expect(markdown).toContain('**Default** `8080`')
    expect(markdown).toContain('**Configured** `8080`')
    expect(markdown).toContain('org.springframework.boot.web.server.ServerProperties')
  })

  it('gives a navigable location only for properties declared in the project', () => {
    expect(locationOfProperty(mailHost)).toEqual({ file: 'src/main/java/com/acme/demo/MailProperties.java', line: 8, startColumn: 5, endColumn: 39 })
    expect(locationOfProperty(port)).toBeNull()
  })
})

describe('navigation', () => {
  const cache = { name: 'cache', type: 'com.acme.demo.Cache', kind: 'bean', class: 'com.acme.demo.CacheConfig', file: 'src/main/java/com/acme/demo/CacheConfig.java', line: 12, startColumn: 5, endColumn: 30 } as SpringBean
  const service = { name: 'orderService', type: 'com.acme.demo.OrderService', kind: 'service', file: 'src/main/java/com/acme/demo/OrderService.java', line: 4, startColumn: 14, endColumn: 29 } as SpringBean
  const qualified = { kind: 'parameter', type: 'com.acme.demo.Cache', name: 'cache', qualifier: 'cache', required: true, class: 'com.acme.demo.OrderService' } as SpringInjection
  const plain = { kind: 'field', type: 'com.acme.demo.OrderService', name: 'service', required: true, class: 'com.acme.demo.OrderController' } as SpringInjection

  it('finds the bean for an injection by qualifier first, then by type', () => {
    const index = indexWith({ beans: [service, cache] })
    expect(beanForInjection(index, qualified)?.name).toBe('cache')
    expect(beanForInjection(index, plain)?.name).toBe('orderService')
    expect(beanForInjection(index, { ...plain, type: 'com.acme.demo.Missing' })).toBeNull()
  })

  it('resolves the property declared in the project', () => {
    expect(propertyForValue(indexWith({ properties: [mailHost] }), 'acme.mail.host')).toBe(mailHost)
    expect(propertyForValue(indexWith({ properties: [mailHost] }), 'acme.unknown')).toBeNull()
  })
})

describe('endpoint filter', () => {
  const find = { method: 'GET', path: '/api/orders/{id}', class: 'com.acme.demo.OrderController', member: 'find', file: 'A.java', line: 14 } as SpringEndpoint
  const create = { method: 'POST', path: '/api/orders', class: 'com.acme.demo.OrderController', member: 'create', file: 'A.java', line: 19 } as SpringEndpoint
  const health = { method: 'GET', path: '/actuator/health', class: 'com.acme.demo.HealthController', member: 'health', file: 'B.java', line: 9 } as SpringEndpoint

  it('matches method, path and member, best match first', () => {
    expect(filterEndpoints([find, create, health], '').map((endpoint) => endpoint.path)).toEqual(['/api/orders/{id}', '/api/orders', '/actuator/health'])
    expect(filterEndpoints([find, create, health], 'GET').map((endpoint) => endpoint.path)).toEqual(['/api/orders/{id}', '/actuator/health'])
    expect(filterEndpoints([find, create, health], 'orders').map((endpoint) => endpoint.path)).toEqual(['/api/orders/{id}', '/api/orders'])
    expect(filterEndpoints([find, create, health], 'health').map((endpoint) => endpoint.member)).toEqual(['health'])
    expect(filterEndpoints([find, create, health], 'nothing')).toHaveLength(0)
  })

  it('puts an exact prefix match before a plain containment', () => {
    const endpoints = [{ ...create, path: '/orders/list' }, { ...find, path: '/api/orders' }] as SpringEndpoint[]
    expect(filterEndpoints(endpoints, '/api/orders')[0].path).toBe('/api/orders')
  })
})
