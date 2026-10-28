import { describe, expect, it } from 'vitest'
import { languageName, languageOfPath, unitBadges, unitForPath, unitLabel, type ProjectRef } from './projectUnits'

const project: ProjectRef = {
  rootPath: 'C:\\work\\shop',
  units: [
    { language: 'go', kind: 'module', root: 'C:\\work\\shop' },
    { language: 'rust', kind: 'cargo-workspace', root: 'C:\\work\\shop\\rust' },
    { language: 'rust', kind: 'cargo-package', root: 'C:\\work\\shop\\rust\\crates\\api' },
    { language: 'python', kind: 'python-project', root: 'C:\\work\\shop\\tools', name: 'tools' },
  ],
}

describe('unitForPath', () => {
  it('attribuisce un file assoluto alla radice più specifica', () => {
    expect(unitForPath(project, 'C:\\work\\shop\\internal\\api\\main.go')?.language).toBe('go')
    expect(unitForPath(project, 'C:\\work\\shop\\rust\\crates\\api\\src\\main.rs')?.kind).toBe('cargo-package')
    expect(unitForPath(project, 'C:\\work\\shop\\rust\\crates\\other\\src\\lib.rs')?.kind).toBe('cargo-workspace')
  })

  it('accetta percorsi relativi alla radice del progetto e barre in avanti', () => {
    expect(unitForPath(project, 'internal/api/main.go')?.language).toBe('go')
    expect(unitForPath(project, 'rust/crates/api/src/main.rs')?.kind).toBe('cargo-package')
  })

  it('ignora il case (lo stesso file arriva in due forme su Windows)', () => {
    expect(unitForPath(project, 'c:/WORK/shop/Rust/Crates/Api/src/main.rs')?.kind).toBe('cargo-package')
  })

  it('restituisce null per file fuori dal progetto e per progetti senza unità', () => {
    expect(unitForPath(project, 'C:\\Users\\other\\sdk\\client.go')).toBeNull()
    expect(unitForPath({ rootPath: 'C:\\work\\shop', units: [] }, 'main.go')).toBeNull()
    expect(unitForPath(null, 'main.go')).toBeNull()
  })

  it('non confonde una cartella con un’altra che inizia con lo stesso nome', () => {
    const units = [{ language: 'go', root: 'C:\\work\\shop\\api' }]
    expect(unitForPath({ rootPath: 'C:\\work\\shop', units }, 'C:\\work\\shop\\apiary\\main.go')).toBeNull()
    expect(unitForPath({ rootPath: 'C:\\work\\shop', units }, 'C:\\work\\shop\\api\\main.go')?.language).toBe('go')
  })
})

describe('languageOfPath', () => {
  it('usa l’unità quando c’è, altrimenti l’estensione', () => {
    expect(languageOfPath(project, 'rust/crates/api/src/main.rs')).toEqual({ id: 'rust', name: 'Rust' })
    // Fuori progetto: un file della SDK resta etichettabile.
    expect(languageOfPath(project, 'C:\\Go\\sdk\\src\\net\\http\\server.go')).toEqual({ id: 'go', name: 'Go' })
    // Un file dentro il progetto senza unità propria ricade sull'unità che lo contiene.
    expect(languageOfPath(project, 'notes.md')).toEqual({ id: 'go', name: 'Go' })
    expect(languageOfPath(project, 'D:\\other\\notes.md')).toBeNull()
    expect(languageOfPath(project, 'go.mod')).toEqual({ id: 'go', name: 'Go' })
  })

  it('conosce i manifest e i file web anche senza unità', () => {
    const empty: ProjectRef = { rootPath: 'C:\\p', units: [] }
    expect(languageOfPath(empty, 'src/app.tsx')).toEqual({ id: 'typescript', name: languageName('typescript') })
    expect(languageOfPath(empty, 'styles/site.scss')).toEqual({ id: 'css', name: 'CSS' })
    expect(languageOfPath(empty, 'package.json')).toEqual({ id: 'json', name: 'JSON' })
  })
})

describe('unitLabel', () => {
  it('mostra nome e percorso relativo dell’unità', () => {
    const unit = unitForPath(project, 'rust/crates/api/src/main.rs')
    expect(unitLabel(project, unit)).toBe('api · rust/crates/api')
  })

  it('usa il percorso relativo quando l’unità non ha nome e la radice per il progetto', () => {
    const unit = unitForPath(project, 'internal/api/main.go')
    expect(unitLabel(project, unit)).toBe('shop')
    expect(unitLabel(project, null, 'Outside the project')).toBe('Outside the project')
  })
})

describe('unitBadges', () => {
  it('dà un’etichetta alle cartelle che sono unità, saltando la radice del progetto', () => {
    expect(unitBadges(project)).toEqual({
      rust: 'Rust',
      'rust/crates/api': 'Rust',
      tools: 'Python',
    })
  })

  it('non inventa etichette per progetti senza unità', () => {
    expect(unitBadges({ rootPath: 'C:\\p', units: [] })).toEqual({})
    expect(unitBadges(null)).toEqual({})
  })
})
