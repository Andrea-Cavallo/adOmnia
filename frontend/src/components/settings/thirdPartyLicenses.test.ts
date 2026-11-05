import { describe, expect, it } from 'vitest'
import goMod from '../../../../go.mod?raw'
import packageJson from '../../../package.json?raw'
import { THIRD_PARTY_LICENSES } from './thirdPartyLicenses'

const listed = new Set(THIRD_PARTY_LICENSES.flatMap(({ packages }) => packages))

describe('third-party licenses in Settings > About', () => {
  it('lists every direct frontend dependency', () => {
    const { dependencies } = JSON.parse(packageJson) as { dependencies: Record<string, string> }
    const shipped = Object.keys(dependencies).filter((name) => !name.startsWith('@types/'))
    expect(shipped.filter((name) => !listed.has(name))).toEqual([])
  })
  it('lists every direct Go dependency', () => {
    const lines = goMod.split(/\r?\n/)
    const direct = lines.flatMap((line) => {
      const match = /^\s*(?:require\s+)?([\w.-]+\.[\w./-]+)\s+v\S+\s*$/.exec(line)
      return match ? [match[1]] : []
    })
    expect(direct.length).toBeGreaterThan(20)
    expect(direct.filter((name) => !listed.has(name))).toEqual([])
  })
})
