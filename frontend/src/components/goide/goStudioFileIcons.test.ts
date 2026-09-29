import { describe, expect, it } from 'vitest'
import { BRAND_ICONS } from '@/lib/brandIcons.generated'
import { brandColors, contrastRatio, resolveGoStudioFileIcon, resolveGoStudioFolderBrand } from './goStudioFileIcons'

describe('Go Studio file icons', () => {
  it('uses the gopher for Go sources and marks tests', () => {
    expect(resolveGoStudioFileIcon('main.go')).toEqual({ kind: 'gopher', test: false })
    expect(resolveGoStudioFileIcon('main_stress_test.go')).toEqual({ kind: 'gopher', test: true })
  })

  it('shows the Go logo for module files, dimmed for generated checksums', () => {
    expect(resolveGoStudioFileIcon('go.mod')).toEqual({ kind: 'goModule', generated: false })
    expect(resolveGoStudioFileIcon('go.work')).toEqual({ kind: 'goModule', generated: false })
    expect(resolveGoStudioFileIcon('go.sum')).toEqual({ kind: 'goModule', generated: true })
  })

  it('recognises Kubernetes manifests, SQL, proto and scripts', () => {
    for (const [name, path] of [['deployment.yaml', 'deploy/deployment.yaml'], ['service-api.yml', 'service-api.yml'], ['app.yaml', 'k8s/app.yaml'], ['kustomization.yaml', 'overlays/prod/kustomization.yaml']]) {
      expect(resolveGoStudioFileIcon(name, path)).toEqual({ kind: 'brand', slug: 'kubernetes' })
    }
    expect(resolveGoStudioFileIcon('pipeline.yaml', 'pipeline.yaml')).toEqual({ kind: 'brand', slug: 'yaml' })
    expect(resolveGoStudioFileIcon('schema.sql')).toEqual({ kind: 'generic', icon: 'sql' })
    expect(resolveGoStudioFileIcon('api.proto')).toEqual({ kind: 'generic', icon: 'schema' })
    expect(resolveGoStudioFileIcon('build.ps1')).toEqual({ kind: 'generic', icon: 'terminal' })
  })

  it('uses the Jenkins emblem for Jenkinsfiles and a key for keys and keystores', () => {
    for (const name of ['Jenkinsfile', 'jenkinsfile', 'Jenkinsfile.release', 'deploy.jenkinsfile']) expect(resolveGoStudioFileIcon(name)).toEqual({ kind: 'jenkins' })
    for (const name of ['server.pem', 'tls.key', 'client.p12', 'store.pfx', 'truststore.jks']) expect(resolveGoStudioFileIcon(name)).toEqual({ kind: 'generic', icon: 'key' })
  })

  it('maps special names and paths to real brands', () => {
    const brand = (name: string, path?: string) => resolveGoStudioFileIcon(name, path)
    expect(brand('Dockerfile')).toEqual({ kind: 'brand', slug: 'docker' })
    expect(brand('docker-compose.prod.yml')).toEqual({ kind: 'brand', slug: 'docker' })
    expect(brand('.gitignore')).toEqual({ kind: 'brand', slug: 'git' })
    expect(brand('ci.yml', '.github/workflows/ci.yml')).toEqual({ kind: 'brand', slug: 'githubactions' })
    expect(brand('ci.yml', 'deploy/ci.yml')).toEqual({ kind: 'brand', slug: 'yaml' })
    expect(brand('.env.local')).toEqual({ kind: 'brand', slug: 'dotenv' })
    expect(brand('openapi.yaml')).toEqual({ kind: 'brand', slug: 'openapiinitiative' })
    expect(brand('Makefile')).toEqual({ kind: 'brand', slug: 'make' })
  })

  it('uses brands for known formats and generic icons for everything without an identity', () => {
    expect(resolveGoStudioFileIcon('README.md')).toEqual({ kind: 'brand', slug: 'markdown' })
    expect(resolveGoStudioFileIcon('config.yaml')).toEqual({ kind: 'brand', slug: 'yaml' })
    expect(resolveGoStudioFileIcon('INSTALLATION.pdf')).toEqual({ kind: 'generic', icon: 'pdf' })
    expect(resolveGoStudioFileIcon('LICENSE')).toEqual({ kind: 'generic', icon: 'license' })
    expect(resolveGoStudioFileIcon('schema.proto')).toEqual({ kind: 'generic', icon: 'schema' })
    expect(resolveGoStudioFileIcon('generic')).toEqual({ kind: 'generic', icon: 'file' })
    expect(resolveGoStudioFolderBrand('.github')).toBe('github')
    expect(resolveGoStudioFolderBrand('internal')).toBeNull()
  })

  it('keeps every brand icon readable on both themes', () => {
    // Il ciano di Go si legge sul tema scuro; sul chiaro (contrasto < 3:1) passa al colore del testo.
    expect(brandColors('00ADD8')).toEqual({ onDark: '#00ADD8', onLight: 'currentColor' })
    expect(brandColors('2496ED').onLight).toBe('#2496ED')
    // Nero su scuro e quasi bianco su chiaro diventano il colore del testo.
    expect(brandColors('000000').onDark).toBe('currentColor')
    expect(brandColors('FEFEFE').onLight).toBe('currentColor')
    for (const [slug, icon] of Object.entries(BRAND_ICONS)) {
      const colors = brandColors(icon.hex)
      if (colors.onDark !== 'currentColor') expect(contrastRatio(icon.hex, '05070D'), slug).toBeGreaterThanOrEqual(3)
      if (colors.onLight !== 'currentColor') expect(contrastRatio(icon.hex, 'F8FAFC'), slug).toBeGreaterThanOrEqual(3)
      expect(icon.path.length, slug).toBeGreaterThan(20)
    }
  })
})
