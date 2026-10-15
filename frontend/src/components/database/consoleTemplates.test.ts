import { describe, expect, it } from 'vitest'
import { STAGE_OPERATORS } from './mongo/AggregationsTab'
import { CONSOLE_TEMPLATES, TEMPLATE_CATEGORIES, specializeTemplate, templatesFor, type ConsoleTemplate } from './consoleTemplates'
import { parseSnippet, renderSnippetText } from './snippet'

const DRIVERS = ['mongodb', 'postgres', 'mysql', 'sqlite', 'redis']
const CATEGORIES = ['search', 'insert', 'update', 'delete', 'aggregate', 'schema']
const RISKS = ['read', 'write', 'destructive']
const SQL_DRIVERS = ['postgres', 'mysql', 'sqlite']

/** Fake values used to prove the bodies stay well-formed once the stops are filled. */
function fakeValues(body: string): Record<number, string> {
  const values: Record<number, string> = {}
  for (const seg of parseSnippet(body).segments) {
    if (seg.stop === undefined || values[seg.stop] !== undefined) continue
    const d = seg.text
    values[seg.stop] = /^-?\d+(\.\d+)?$/.test(d)
      ? '5'
      : d === 'true' || d === 'false'
        ? 'true'
        : d === 'null'
          ? 'null'
          : d === ''
            ? ''
            : 'fakeValue'
  }
  return values
}

function renderedWithFakes(template: ConsoleTemplate): string {
  return renderSnippetText(parseSnippet(template.body), fakeValues(template.body))
}

function renderedWithDefaults(template: ConsoleTemplate): string {
  return renderSnippetText(parseSnippet(template.body), {})
}

describe('template registry integrity', () => {
  it('has unique, well-formed ids', () => {
    const ids = CONSOLE_TEMPLATES.map((t) => t.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it('declares valid driver, category and risk on every template', () => {
    for (const t of CONSOLE_TEMPLATES) {
      expect(DRIVERS).toContain(t.driver)
      expect(CATEGORIES).toContain(t.category)
      expect(RISKS).toContain(t.risk)
    }
  })

  it('has non-empty title, description and body everywhere', () => {
    for (const t of CONSOLE_TEMPLATES) {
      expect(t.title.trim().length).toBeGreaterThan(0)
      expect(t.description.trim().length).toBeGreaterThan(0)
      expect(t.body.trim().length).toBeGreaterThan(0)
    }
  })

  it('lists one label per category and covers every used category', () => {
    expect(TEMPLATE_CATEGORIES).toHaveLength(CATEGORIES.length)
    expect(new Set(TEMPLATE_CATEGORIES.map((c) => c.id)).size).toBe(TEMPLATE_CATEGORIES.length)
    for (const c of TEMPLATE_CATEGORIES) {
      expect(CATEGORIES).toContain(c.id)
      expect(c.label.trim().length).toBeGreaterThan(0)
    }
    for (const t of CONSOLE_TEMPLATES) {
      expect(TEMPLATE_CATEGORIES.map((c) => c.id)).toContain(t.category)
    }
  })

  it('expands every body without leaving snippet syntax behind', () => {
    for (const t of CONSOLE_TEMPLATES) {
      const rendered = renderedWithDefaults(t)
      expect(rendered).not.toMatch(/\$\{\d/)
      expect(rendered).not.toContain('$0')
    }
  })
})

describe('risk is coherent with the category', () => {
  it('marks delete and drop as destructive, reads as read, writes as write', () => {
    for (const t of CONSOLE_TEMPLATES) {
      const haystack = `${t.title} ${t.body}`
      if (t.category === 'delete') expect(t.risk).toBe('destructive')
      if (/drop/i.test(haystack)) expect(t.risk).toBe('destructive')
      if (t.category === 'search' || t.category === 'aggregate') expect(t.risk).toBe('read')
      if (t.category === 'insert' || t.category === 'update') expect(t.risk).toBe('write')
      if (t.category === 'schema' && !/drop/i.test(haystack)) {
        expect(t.risk).toBe(/create|alter|add/i.test(haystack) ? 'write' : 'read')
      }
    }
  })
})

describe('Mongo and Redis bodies are valid JSON', () => {
  const jsonTemplates = CONSOLE_TEMPLATES.filter((t) => t.driver === 'mongodb' || t.driver === 'redis')

  it('has JSON bodies for both drivers', () => {
    expect(jsonTemplates.filter((t) => t.driver === 'mongodb').length).toBeGreaterThan(0)
    expect(jsonTemplates.filter((t) => t.driver === 'redis').length).toBeGreaterThan(0)
  })

  it('parses after substituting the placeholders with fake values', () => {
    for (const t of jsonTemplates) {
      expect(() => JSON.parse(renderedWithFakes(t))).not.toThrow()
    }
  })

  it('parses with the placeholder defaults too', () => {
    for (const t of jsonTemplates) {
      expect(() => JSON.parse(renderedWithDefaults(t))).not.toThrow()
    }
  })
})

describe('Mongo template coverage', () => {
  const mongoTemplates = CONSOLE_TEMPLATES.filter((t) => t.driver === 'mongodb')

  it('covers every operation the backend runner implements', () => {
    const ops = mongoTemplates.map(
      (t) => (JSON.parse(renderedWithDefaults(t)) as { operation: string }).operation
    )
    for (const op of [
      'find', 'count', 'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
      'deleteOne', 'deleteMany', 'aggregate', 'createCollection', 'dropCollection', 'runCommand',
    ]) {
      expect(ops).toContain(op)
    }
  })

  it('covers find variants and the four updateMany operators', () => {
    const bodies = mongoTemplates.map((t) => t.body)
    expect(bodies.filter((b) => b.includes('"operation": "find"')).length).toBeGreaterThanOrEqual(3)
    const updates = bodies.filter((b) => b.includes('"updateMany"')).join('\n')
    for (const op of ['"$set"', '"$inc"', '"$unset"', '"$push"']) {
      expect(updates).toContain(op)
    }
  })

  it('covers create, list and drop of indexes through runCommand', () => {
    const commands = mongoTemplates.filter((t) => t.body.includes('"runCommand"')).map((t) => t.body).join('\n')
    for (const cmd of ['"createIndexes"', '"listIndexes"', '"dropIndexes"']) {
      expect(commands).toContain(cmd)
    }
  })

  it('builds aggregate pipelines with the stages of AggregationsTab', () => {
    const aggregate = mongoTemplates.filter((t) => t.category === 'aggregate')
    expect(aggregate.length).toBeGreaterThan(0)
    for (const t of aggregate) {
      const query = JSON.parse(renderedWithDefaults(t)) as { pipeline: Record<string, unknown>[] }
      expect(Array.isArray(query.pipeline)).toBe(true)
      expect(query.pipeline.length).toBeGreaterThan(0)
      for (const stage of query.pipeline) {
        for (const key of Object.keys(stage)) {
          expect(STAGE_OPERATORS as readonly string[]).toContain(key)
        }
      }
    }
    expect(renderedWithDefaults(aggregate.find((t) => t.id === 'mongo-aggregate-stage')!)).toContain('$match')
  })
})

describe('Redis template coverage', () => {
  const redisTemplates = CONSOLE_TEMPLATES.filter((t) => t.driver === 'redis')

  it('covers the data commands of the runner allowlist', () => {
    const bodies = redisTemplates.map((t) => t.body).join('\n')
    for (const cmd of ['"GET"', '"SET"', '"DEL"', '"EXPIRE"', '"TTL"', '"HGETALL"', '"HSET"', '"LPUSH"', '"LRANGE"', '"SADD"', '"SMEMBERS"']) {
      expect(bodies).toContain(cmd)
    }
  })

  it('covers scan and inspect in the operations format', () => {
    const bodies = redisTemplates.map((t) => t.body).join('\n')
    expect(bodies).toContain('"operation": "scan"')
    expect(bodies).toContain('"operation": "inspect"')
  })

  it('uses the {command,args} or {operation} shapes of redis.go', () => {
    for (const t of redisTemplates) {
      const q = JSON.parse(renderedWithFakes(t)) as { command?: string; args?: string[]; operation?: string }
      if (q.operation !== undefined) {
        expect(['scan', 'inspect']).toContain(q.operation)
      } else {
        expect(typeof q.command).toBe('string')
        expect(Array.isArray(q.args)).toBe(true)
      }
    }
  })
})

describe('SQL template coverage per dialect', () => {
  it('offers the same statement kinds for every SQL dialect', () => {
    for (const driver of SQL_DRIVERS) {
      const all = templatesFor(driver).map((t) => t.body).join('\n')
      expect(all).toContain('SELECT ${1:*}')
      expect(all).toContain('JOIN ')
      expect(all).toContain('GROUP BY ')
      expect(all).toContain('WITH ')
      expect(all).toContain('INSERT INTO ')
      expect(all).toContain('UPDATE ')
      expect(all).toContain('DELETE FROM ')
      expect(all).toContain('CREATE TABLE ')
      expect(all).toContain('ALTER TABLE ')
      expect(all).toContain('CREATE ${1|INDEX')
      expect(all).toContain('DROP ${1|TABLE,INDEX|}')
      expect(all).toContain('LIMIT ')
    }
  })

  it('spells the dialect differences: ON CONFLICT, ON DUPLICATE KEY, RETURNING', () => {
    const postgres = templatesFor('postgres').map((t) => t.body).join('\n')
    const mysql = templatesFor('mysql').map((t) => t.body).join('\n')
    const sqlite = templatesFor('sqlite').map((t) => t.body).join('\n')
    expect(postgres).toContain('ON CONFLICT')
    expect(sqlite).toContain('ON CONFLICT')
    expect(mysql).toContain('ON DUPLICATE KEY')
    expect(mysql).not.toContain('ON CONFLICT')
    expect(postgres).toContain('RETURNING ')
    expect(sqlite).toContain('RETURNING ')
    expect(mysql).not.toContain('RETURNING ')
    expect(postgres).not.toContain('ON DUPLICATE KEY')
    expect(postgres).not.toContain('TOP ')
  })
})

describe('templatesFor', () => {
  it('filters by driver and by category', () => {
    expect(templatesFor('mongodb').length).toBeGreaterThan(0)
    expect(templatesFor('mongodb').every((t) => t.driver === 'mongodb')).toBe(true)
    expect(templatesFor('mongodb', 'update').every((t) => t.category === 'update')).toBe(true)
    expect(templatesFor('mongodb', 'update')).toHaveLength(6)
    expect(templatesFor('postgres', 'delete').every((t) => t.risk === 'destructive')).toBe(true)
  })

  it('returns nothing for an unknown driver or category', () => {
    expect(templatesFor('oracle')).toHaveLength(0)
    expect(templatesFor('mongodb', 'nosuch' as never)).toHaveLength(0)
    expect(templatesFor('')).toHaveLength(0)
  })

  it('covers every driver', () => {
    for (const driver of DRIVERS) {
      expect(templatesFor(driver).length).toBeGreaterThan(0)
    }
  })
})

describe('specializeTemplate', () => {
  const find = CONSOLE_TEMPLATES.find((t) => t.id === 'mongo-find-filter')!

  it('precompiles the collection and database stops but keeps them tab stops', () => {
    const body = specializeTemplate(find.body, { table: 'utenti', database: 'shop' })
    const parsed = parseSnippet(body)
    const text = renderSnippetText(parsed, {})
    expect(text).toContain('"collection": "utenti"')
    expect(text).toContain('"database": "shop"')
    expect(parsed.stops).toBe(parseSnippet(find.body).stops)
  })

  it('turns the first field stop into a choice list of real columns', () => {
    const body = specializeTemplate(find.body, { columns: ['nome', 'stato', 'eta'] })
    const field = parseSnippet(body).segments.find((s) => s.stop === 3)
    expect(field?.choices).toEqual(['nome', 'stato', 'eta'])
  })

  it('never produces broken snippet syntax from odd names', () => {
    const body = specializeTemplate(find.body, { table: 'we$ird}name', columns: ['a,b', 'ok1', 'ok2'] })
    expect(() => JSON.parse(renderSnippetText(parseSnippet(body), { 4: 'x', 6: '20' }))).not.toThrow()
  })

  it('leaves SQL bodies valid', () => {
    const sql = templatesFor('postgres', 'update')[0]
    const text = renderSnippetText(parseSnippet(specializeTemplate(sql.body, { table: 'utenti' })), {})
    expect(text).toContain('UPDATE utenti')
  })
})
