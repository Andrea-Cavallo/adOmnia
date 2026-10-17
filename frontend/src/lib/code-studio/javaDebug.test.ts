import { describe, expect, it } from 'vitest'
import { javaMainClassOf } from './javaDebug'

describe('javaMainClassOf', () => {
  it('reads the class of a Main Class configuration', () => {
    expect(javaMainClassOf(['-B', 'compile', 'org.codehaus.mojo:exec-maven-plugin:3.5.0:java', '-Dexec.mainClass=it.acme.App'])).toBe('it.acme.App')
  })
  it('ignores configurations without a main class or with a suspicious one', () => {
    expect(javaMainClassOf(['spring-boot:run'])).toBe('')
    expect(javaMainClassOf(['-Dexec.mainClass=a b; rm'])).toBe('')
  })
})
