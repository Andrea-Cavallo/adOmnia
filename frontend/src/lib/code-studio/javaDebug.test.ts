import { describe, expect, it } from 'vitest'
import { javaDebugTargetOf, javaMainClassOf } from './javaDebug'

describe('javaMainClassOf', () => {
  it('reads the class of a Main Class configuration', () => {
    expect(javaMainClassOf(['-B', 'compile', 'org.codehaus.mojo:exec-maven-plugin:3.5.0:java', '-Dexec.mainClass=it.acme.App'])).toBe('it.acme.App')
  })
  it('ignores configurations without a main class or with a suspicious one', () => {
    expect(javaMainClassOf(['spring-boot:run'])).toBe('')
    expect(javaMainClassOf(['-Dexec.mainClass=a b; rm'])).toBe('')
  })
})

describe('javaDebugTargetOf', () => {
  it('debugs a main class with its VM options and non-secret environment', () => {
    expect(javaDebugTargetOf({
      kind: 'main', language: 'java', workingDirectory: 'api', programArguments: ['--x'],
      environment: [{ key: 'A', value: '1' }, { key: 'S', secret: true }], languageOptions: { mainClass: 'it.acme.App', vmOptions: ['-Xmx1g'] },
    })).toEqual({ mainClass: 'it.acme.App', workingDirectory: 'api', programArguments: ['--x'], vmArguments: ['-Xmx1g'], environment: { A: '1' } })
  })
  it('attaches to a remote JVM and rejects a bad port', () => {
    expect(javaDebugTargetOf({ kind: 'attach', language: 'java', languageOptions: { host: 'build.local', port: '5006' } })).toMatchObject({ attachHost: 'build.local', attachPort: 5006 })
    expect(javaDebugTargetOf({ kind: 'attach', language: 'java', languageOptions: { port: '70000' } })).toBeNull()
  })
  it('lets the host open the JDWP port for test and Spring Boot builds', () => {
    expect(javaDebugTargetOf({ kind: 'command', language: 'java', workingDirectory: 'api', programArguments: ['-f', 'x/pom.xml', 'spring-boot:run'] })).toEqual({ buildArguments: ['-f', 'x/pom.xml', 'spring-boot:run'], workingDirectory: 'api' })
    expect(javaDebugTargetOf({ kind: 'command', language: 'java', programArguments: ['quarkus:dev'] })).toEqual({ buildArguments: ['quarkus:dev'], workingDirectory: '' })
    expect(javaDebugTargetOf({ kind: 'command', language: 'java', programArguments: [':api:quarkusDev'] })).toEqual({ buildArguments: [':api:quarkusDev'], workingDirectory: '' })
    expect(javaDebugTargetOf({ kind: 'command', language: 'java', programArguments: ['package'] })).toBeNull()
    expect(javaDebugTargetOf({ kind: 'main', language: 'go', languageOptions: { mainClass: 'a.B' } })).toBeNull()
  })
})

it('debugs qualified Gradle tasks and forwards non-secret environment overrides', () => {
  expect(javaDebugTargetOf({ kind: 'command', language: 'java', programArguments: [':api:bootRun'], environment: [{ key: 'SPRING_PROFILES_ACTIVE', value: 'local' }, { key: 'TOKEN', value: 'vault:secret', secret: true }] })).toEqual({ buildArguments: [':api:bootRun'], workingDirectory: '', environment: { SPRING_PROFILES_ACTIVE: 'local' } })
})
