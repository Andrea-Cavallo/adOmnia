export interface LiveTemplate {
  id: string
  abbreviation: string
  description: string
  body: string
  languages: readonly string[]
}

const escapeSnippet = (value: string) => value.replace(/[\\$}]/g, character => `\\${character}`)

/** A small data-only template format. Names are linked fields, never executable expressions. */
export function templateSnippet(body: string, selection = ''): string {
  const names = new Map<string, number>()
  let snippet = ''
  let hasEnd = false
  let cursor = 0
  const pattern = /\$\$|\$([A-Za-z_][A-Za-z0-9_]*)\$/g
  for (const match of body.matchAll(pattern)) {
    snippet += escapeSnippet(body.slice(cursor, match.index))
    cursor = match.index! + match[0].length
    const name = match[1]
    if (!name) snippet += '\\$'
    else if (name === 'END') { snippet += '$0'; hasEnd = true }
    else if (name === 'SELECTION') {
      const prefix = body.slice(body.lastIndexOf('\n', match.index) + 1, match.index)
      const indent = /^[\t ]*$/.test(prefix) ? prefix : ''
      snippet += escapeSnippet(selection.replace(/\n/g, `\n${indent}`))
    }
    else {
      const existing = names.get(name)
      const index = existing ?? names.size + 1
      names.set(name, index)
      snippet += existing ? `$${index}` : `\${${index}:${name.toLowerCase()}}`
    }
  }
  return snippet + escapeSnippet(body.slice(cursor)) + (hasEnd ? '' : '$0')
}

export const templateUsesSelection = (body: string): boolean => [...body.matchAll(/\$\$|\$([A-Za-z_][A-Za-z0-9_]*)\$/g)].some(match => match[1] === 'SELECTION')

export function templatesFor(templates: readonly LiveTemplate[], language: string, surround: boolean): LiveTemplate[] {
  return templates.filter(template => template.languages.includes(language) && templateUsesSelection(template.body) === surround)
}

export function parseUserTemplates(raw: string): LiveTemplate[] {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || value.length > 200) throw new Error('Use an array of at most 200 templates.')
  const ids = new Set<string>()
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Each template must be an object.')
    const template = item as Record<string, unknown>
    for (const key of ['id', 'abbreviation', 'description', 'body']) {
      if (typeof template[key] !== 'string' || !(template[key] as string).trim()) throw new Error(`Template ${key} must be nonempty text.`)
    }
    const { id, abbreviation, description, body, languages } = template as unknown as LiveTemplate
    if (id.length > 100 || abbreviation.length > 80 || description.length > 300 || body.length > 32_768) throw new Error('Template exceeds the size limit.')
    if (!/^[\w.-]+$/.test(id) || !/^[\w.-]+$/.test(abbreviation)) throw new Error('Template ids and abbreviations may contain letters, digits, _, . and - only.')
    if (!Array.isArray(languages) || !languages.length || languages.some(language => typeof language !== 'string' || !/^[\w+-]{1,80}$/.test(language))) throw new Error('Each template needs at least one editor language id.')
    if (ids.has(id)) throw new Error(`Duplicate template id: ${id}`)
    ids.add(id)
    return { id, abbreviation, description, body, languages: [...new Set(languages)] }
  })
}
