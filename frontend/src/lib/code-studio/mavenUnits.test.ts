import { describe, expect, it } from 'vitest'
import type { GoIDESession } from '@/lib/code-studio-api'
import { mavenBuildUnits } from './mavenUnits'

const project = (units: Array<{ language: string; kind: string; root: string; manifest?: string; name?: string }>) => ({ rootPath: 'C:/p', units }) as unknown as GoIDESession['project']

describe('mavenBuildUnits', () => {
  it('keeps Maven and Gradle units that have a manifest, drops Go and manifest-less ones', () => {
    const units = mavenBuildUnits(project([
      { language: 'java', kind: 'maven', root: 'C:/p/api', manifest: 'C:/p/api/pom.xml', name: 'api' },
      { language: 'java', kind: 'gradle', root: 'C:/p/app', manifest: 'C:/p/app/build.gradle' },
      { language: 'go', kind: 'module', root: 'C:/p/svc', manifest: 'C:/p/svc/go.mod' },
      { language: 'java', kind: 'loose', root: 'C:/p/x' },
    ]))
    expect(units.map((unit) => unit.manifest)).toEqual(['C:/p/api/pom.xml', 'C:/p/app/build.gradle'])
    expect(units[1].name).toBe('app')
  })
})
