import { describe, expect, it } from 'vitest'
import { BRAND_ICONS } from '@/lib/brandIcons.generated'
import { brandColors, contrastRatio, resolveCodeStudioFileIcon } from './codeStudioFileIcons'

describe('Code Studio file icons', () => {
  it('gets manifests and generated lockfiles from language contributions', () => {
    for (const name of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'main.rs']) expect(resolveCodeStudioFileIcon(name)).toEqual({ kind: 'brand', slug: 'rust' })
    for (const name of ['pyproject.toml', 'uv.lock', 'poetry.lock', 'requirements-dev.txt', 'typing.pyi']) expect(resolveCodeStudioFileIcon(name)).toEqual({ kind: 'brand', slug: 'python' })
    expect(resolveCodeStudioFileIcon('gradlew.bat')).toEqual({ kind: 'brand', slug: 'gradle' })
    expect(resolveCodeStudioFileIcon('.prettierignore')).toEqual({ kind: 'brand', slug: 'prettier' })
    expect(resolveCodeStudioFileIcon('app.scss')).toEqual({ kind: 'brand', slug: 'css' })
  })
  it('uses the gopher for Go sources and marks tests', () => {
    expect(resolveCodeStudioFileIcon('main.go')).toEqual({ kind: 'gopher', test: false })
    expect(resolveCodeStudioFileIcon('main_stress_test.go')).toEqual({ kind: 'gopher', test: true })
  })

  it('shows the Go logo for module files, dimmed for generated checksums', () => {
    expect(resolveCodeStudioFileIcon('go.mod')).toEqual({ kind: 'goModule', generated: false })
    expect(resolveCodeStudioFileIcon('go.work')).toEqual({ kind: 'goModule', generated: false })
    expect(resolveCodeStudioFileIcon('go.sum')).toEqual({ kind: 'goModule', generated: true })
  })

  it('recognises Kubernetes manifests, SQL, proto and scripts', () => {
    for (const [name, path] of [['deployment.yaml', 'deploy/deployment.yaml'], ['service-api.yml', 'service-api.yml'], ['app.yaml', 'k8s/app.yaml'], ['kustomization.yaml', 'overlays/prod/kustomization.yaml']]) {
      expect(resolveCodeStudioFileIcon(name, path)).toEqual({ kind: 'brand', slug: 'kubernetes' })
    }
    expect(resolveCodeStudioFileIcon('pipeline.yaml', 'pipeline.yaml')).toEqual({ kind: 'brand', slug: 'yaml' })
    expect(resolveCodeStudioFileIcon('schema.sql')).toEqual({ kind: 'generic', icon: 'sql' })
    expect(resolveCodeStudioFileIcon('api.proto')).toEqual({ kind: 'generic', icon: 'schema' })
    expect(resolveCodeStudioFileIcon('build.ps1')).toEqual({ kind: 'generic', icon: 'terminal' })
  })

  it('uses the Jenkins emblem for Jenkinsfiles and a key for keys and keystores', () => {
    for (const name of ['Jenkinsfile', 'jenkinsfile', 'Jenkinsfile.release', 'deploy.jenkinsfile']) expect(resolveCodeStudioFileIcon(name)).toEqual({ kind: 'jenkins' })
    for (const name of ['server.pem', 'tls.key', 'client.p12', 'store.pfx', 'truststore.jks']) expect(resolveCodeStudioFileIcon(name)).toEqual({ kind: 'generic', icon: 'key' })
  })

  it('gives other languages and their build files their own brand', () => {
    const slug = (path: string) => { const icon = resolveCodeStudioFileIcon(path); return icon.kind === 'brand' ? icon.slug : icon.kind }
    expect(resolveCodeStudioFileIcon('Main.java')).toEqual({ kind: 'java' })
    expect([slug('app.kt'), slug('pom.xml'), slug('build.gradle.kts'), slug('index.php'), slug('lib.cpp'), slug('util.h')])
      .toEqual(['kotlin', 'apachemaven', 'gradle', 'php', 'cplusplus', 'c'])
  })

  it('maps special names and paths to real brands', () => {
    const brand = (name: string, path?: string) => resolveCodeStudioFileIcon(name, path)
    expect(brand('Dockerfile')).toEqual({ kind: 'brand', slug: 'docker' })
    expect(brand('docker-compose.prod.yml')).toEqual({ kind: 'brand', slug: 'docker' })
    expect(brand('.gitignore')).toEqual({ kind: 'brand', slug: 'git' })
    expect(brand('ci.yml', '.github/workflows/ci.yml')).toEqual({ kind: 'brand', slug: 'githubactions' })
    expect(brand('ci.yml', 'deploy/ci.yml')).toEqual({ kind: 'brand', slug: 'yaml' })
    expect(brand('.env.local')).toEqual({ kind: 'brand', slug: 'dotenv' })
    expect(brand('openapi.yaml')).toEqual({ kind: 'brand', slug: 'openapiinitiative' })
    expect(brand('Makefile')).toEqual({ kind: 'brand', slug: 'make' })
    expect(brand('CLAUDE.md')).toEqual({ kind: 'brand', slug: 'claude' })
    expect(brand('claude.md')).toEqual({ kind: 'brand', slug: 'claude' })
  })

  it('uses brands for known formats and generic icons for everything without an identity', () => {
    expect(resolveCodeStudioFileIcon('README.md')).toEqual({ kind: 'brand', slug: 'markdown' })
    expect(resolveCodeStudioFileIcon('config.yaml')).toEqual({ kind: 'brand', slug: 'yaml' })
    expect(resolveCodeStudioFileIcon('INSTALLATION.pdf')).toEqual({ kind: 'generic', icon: 'pdf' })
    expect(resolveCodeStudioFileIcon('LICENSE')).toEqual({ kind: 'generic', icon: 'license' })
    expect(resolveCodeStudioFileIcon('schema.proto')).toEqual({ kind: 'generic', icon: 'schema' })
    expect(resolveCodeStudioFileIcon('generic')).toEqual({ kind: 'generic', icon: 'file' })
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
      expect(icon.path.length, slug).toBeGreaterThan(10) // Kotlin è un solo poligono di 20 caratteri
    }
  })
})
