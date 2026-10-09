import { describe, expect, it } from 'vitest'
import type { DevEntity } from '@/lib/devcontext-api'
import { configReport, profileDiff, profileName } from './configReport'

const env = (name: string, attrs: Record<string, string>, sources: Array<[string, string, number]>): DevEntity => ({
  id: `envvar:${name}`, kind: 'envvar', label: name, attrs, confidence: 'certain',
  sources: sources.map(([detector, file, line]) => ({ detector, file, line })),
})

const entities: DevEntity[] = [
  env('PORT', { value: '8080', 'value@.env': '8080', 'value@.env.staging': '9090' }, [['goliterals', 'main.go', 12], ['dotenv', '.env', 1], ['dotenv', '.env.staging', 1]]),
  env('DB_URL', { value: 'postgres://u:•••@db/app', 'value@.env': 'postgres://u:•••@db/app' }, [['goliterals', 'store/db.go', 8], ['dotenv', '.env', 2]]),
  env('API_TOKEN', {}, [['goliterals', 'client.go', 5]]),
  env('OLD_FLAG', { 'value@.env.staging': 'true' }, [['dotenv', '.env.staging', 2]]),
  { id: 'route:GET /x', kind: 'route', label: 'GET /x', attrs: {}, sources: [], confidence: 'certain' },
]

describe('configReport', () => {
  it('classifies keys and lists profiles', () => {
    const report = configReport(entities)
    expect(report.profiles).toEqual(['.env', '.env.staging'])
    expect(report.keys.map((k) => `${k.status}:${k.name}`)).toEqual(['missing:API_TOKEN', 'partial:DB_URL', 'unused:OLD_FLAG', 'ok:PORT'])
    expect(report.keys[1].missingIn).toEqual(['.env.staging'])
    expect(report.counts).toEqual({ ok: 1, missing: 1, unused: 1, partial: 1 })
  })

  it('diffs two profiles', () => {
    expect(profileDiff(configReport(entities), '.env', '.env.staging')).toEqual([
      { name: 'DB_URL', left: 'postgres://u:•••@db/app', right: undefined },
      { name: 'OLD_FLAG', left: undefined, right: 'true' },
      { name: 'PORT', left: '8080', right: '9090' },
    ])
  })

  it('names profiles', () => {
    expect(profileName('.env')).toBe('default')
    expect(profileName('deploy/.env.staging')).toBe('staging')
  })
})
