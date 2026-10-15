import { describe, expect, it } from 'vitest'
import {
  countRewrite,
  interpret,
  splitStatements,
  statementAt,
  type DbKind,
  type QueryInterpretation,
  type QuerySchema,
} from './queryInterpreter'

// Table-driven tests for the query interpreter (FIX.md DB-3.2.1 / DB-3.2.4 / DB-3.2.5).

interface InterpretCase {
  name: string
  driver: DbKind
  text: string
  schema?: QuerySchema
  want: Pick<QueryInterpretation, 'kind' | 'targets' | 'filterPresent' | 'writes' | 'risk' | 'issues'>
  summary?: string
  summaryIncludes?: string
}

function expectCase(c: InterpretCase): void {
  const r = interpret(c.driver, c.text, c.schema)
  expect({
    kind: r.kind,
    targets: r.targets,
    filterPresent: r.filterPresent,
    writes: r.writes,
    risk: r.risk,
    issues: r.issues,
  }).toEqual(c.want)
  if (c.summary !== undefined) expect(r.summary).toBe(c.summary)
  if (c.summaryIncludes !== undefined) expect(r.summary).toContain(c.summaryIncludes)
}

// ── interpret: SQL ───────────────────────────────────────────────────────────

const sqlCases: InterpretCase[] = [
  {
    name: 'select with WHERE',
    driver: 'postgres',
    text: 'SELECT id, nome FROM utenti WHERE id = 1',
    want: { kind: 'select', targets: ['utenti'], filterPresent: true, writes: false, risk: 'read', issues: [] },
    summary: 'Reads from `utenti` where ….',
  },
  {
    name: 'select without WHERE',
    driver: 'postgres',
    text: 'SELECT id FROM utenti',
    want: { kind: 'select', targets: ['utenti'], filterPresent: false, writes: false, risk: 'read', issues: [] },
    summary: 'Reads from `utenti`.',
  },
  {
    name: 'select * is flagged',
    driver: 'postgres',
    text: 'SELECT * FROM utenti',
    want: { kind: 'select', targets: ['utenti'], filterPresent: false, writes: false, risk: 'read', issues: ['select *'] },
  },
  {
    name: 'DELETE without WHERE on the next line is still unfiltered',
    driver: 'postgres',
    text: 'DELETE\nFROM utenti',
    want: { kind: 'delete', targets: ['utenti'], filterPresent: false, writes: true, risk: 'destructive', issues: ['no filter'] },
    summary: 'Deletes all rows from `utenti`.',
  },
  {
    name: 'update without WHERE is destructive',
    driver: 'postgres',
    text: "UPDATE utenti SET nome = 'x'",
    want: { kind: 'update', targets: ['utenti'], filterPresent: false, writes: true, risk: 'destructive', issues: ['no filter'] },
    summary: 'Updates all rows in `utenti`.',
  },
  {
    name: 'update with WHERE on its own line counts as a filter',
    driver: 'postgres',
    text: 'UPDATE utenti\nSET nome = \'x\'\nWHERE id = 2',
    want: { kind: 'update', targets: ['utenti'], filterPresent: true, writes: true, risk: 'write', issues: [] },
    summary: 'Updates rows in `utenti` where ….',
  },
  {
    name: 'update with WHERE is a plain write',
    driver: 'postgres',
    text: "UPDATE utenti SET nome = 'x' WHERE id = 2",
    want: { kind: 'update', targets: ['utenti'], filterPresent: true, writes: true, risk: 'write', issues: [] },
    summary: 'Updates rows in `utenti` where ….',
  },
  {
    name: 'delete with WHERE is a plain write',
    driver: 'postgres',
    text: 'DELETE FROM utenti WHERE id = 3',
    want: { kind: 'delete', targets: ['utenti'], filterPresent: true, writes: true, risk: 'write', issues: [] },
    summary: 'Deletes rows from `utenti` where ….',
  },
  {
    name: 'insert',
    driver: 'postgres',
    text: "INSERT INTO utenti (nome) VALUES ('x')",
    want: { kind: 'insert', targets: ['utenti'], filterPresent: false, writes: true, risk: 'write', issues: [] },
    summary: 'Inserts into `utenti`.',
  },
  {
    name: 'select with join lists every table',
    driver: 'postgres',
    text: 'SELECT u.id FROM utenti u JOIN ordini o ON o.user_id = u.id',
    want: { kind: 'select', targets: ['utenti', 'ordini'], filterPresent: false, writes: false, risk: 'read', issues: [] },
    summary: 'Reads from `utenti`, `ordini`.',
  },
  {
    name: 'multiple statements',
    driver: 'postgres',
    text: 'SELECT * FROM utenti; SELECT * FROM ordini',
    want: {
      kind: 'select',
      targets: ['utenti', 'ordini'],
      filterPresent: false,
      writes: false,
      risk: 'read',
      issues: ['select *', 'multiple statements'],
    },
  },
  {
    name: 'multiple writes without filter',
    driver: 'postgres',
    text: 'UPDATE utenti SET a = 1; DELETE FROM ordini',
    want: {
      kind: 'update',
      targets: ['utenti', 'ordini'],
      filterPresent: false,
      writes: true,
      risk: 'destructive',
      issues: ['no filter', 'multiple statements'],
    },
    summary: 'Updates all rows in `utenti`.',
  },
  {
    name: 'drop table',
    driver: 'postgres',
    text: 'DROP TABLE utenti',
    want: { kind: 'drop', targets: ['utenti'], filterPresent: false, writes: true, risk: 'destructive', issues: [] },
    summary: 'Drops `utenti`.',
  },
  {
    name: 'create table',
    driver: 'postgres',
    text: 'CREATE TABLE utenti (id INT)',
    want: { kind: 'create', targets: ['utenti'], filterPresent: false, writes: true, risk: 'write', issues: [] },
    summary: 'Creates `utenti`.',
  },
  {
    name: 'mysql update without WHERE is destructive too',
    driver: 'mysql',
    text: 'UPDATE utenti SET a = 1',
    want: { kind: 'update', targets: ['utenti'], filterPresent: false, writes: true, risk: 'destructive', issues: ['no filter'] },
  },
  {
    name: 'CTE is classified by its main statement',
    driver: 'postgres',
    text: 'WITH x AS (SELECT 1) SELECT * FROM x',
    want: { kind: 'select', targets: ['x'], filterPresent: false, writes: false, risk: 'read', issues: ['select *'] },
    summary: 'Reads from `x`.',
  },
]

describe('interpret — SQL', () => {
  it.each(sqlCases)('$name', (c) => expectCase(c))
})

// ── interpret: schema checks ─────────────────────────────────────────────────

const schemaCases: InterpretCase[] = [
  {
    name: 'unknown column is flagged',
    driver: 'postgres',
    text: "SELECT * FROM utenti WHERE statoo = 'x'",
    schema: { tables: [{ name: 'utenti', columns: ['id', 'nome'] }] },
    want: {
      kind: 'select',
      targets: ['utenti'],
      filterPresent: true,
      writes: false,
      risk: 'read',
      issues: ['select *', 'unknown column `statoo`'],
    },
  },
  {
    name: 'unknown table is flagged',
    driver: 'postgres',
    text: 'SELECT id FROM sconosciuta',
    schema: { tables: [{ name: 'utenti', columns: ['id'] }] },
    want: {
      kind: 'select',
      targets: ['sconosciuta'],
      filterPresent: false,
      writes: false,
      risk: 'read',
      issues: ['unknown table `sconosciuta`'],
    },
    summary: 'Reads from `sconosciuta`.',
  },
  {
    name: 'unknown column in SET is flagged',
    driver: 'postgres',
    text: 'UPDATE utenti SET statoo = 1 WHERE id = 2',
    schema: { tables: [{ name: 'utenti', columns: ['id', 'nome'] }] },
    want: {
      kind: 'update',
      targets: ['utenti'],
      filterPresent: true,
      writes: true,
      risk: 'write',
      issues: ['unknown column `statoo`'],
    },
  },
]

describe('interpret — schema checks', () => {
  it.each(schemaCases)('$name', (c) => expectCase(c))
})

// ── interpret: MongoDB ───────────────────────────────────────────────────────

const mongoCases: InterpretCase[] = [
  {
    name: 'find with filter',
    driver: 'mongodb',
    text: '{"operation":"find","collection":"users","filter":{"age":{"$gt":18}}}',
    want: { kind: 'find', targets: ['users'], filterPresent: true, writes: false, risk: 'read', issues: [] },
    summary: 'Reads documents from `users` where ….',
  },
  {
    name: 'find without filter',
    driver: 'mongodb',
    text: '{"operation":"find","collection":"users"}',
    want: { kind: 'find', targets: ['users'], filterPresent: false, writes: false, risk: 'read', issues: [] },
    summary: 'Reads documents from `users`.',
  },
  {
    name: 'shell syntax document is accepted',
    driver: 'mongodb',
    text: "{ operation: 'find', collection: 'users', filter: { a: 1 } }",
    want: { kind: 'find', targets: ['users'], filterPresent: true, writes: false, risk: 'read', issues: [] },
    summaryIncludes: 'Reads documents from `users`',
  },
  {
    name: 'updateMany without filter is destructive',
    driver: 'mongodb',
    text: '{"operation":"updateMany","collection":"users","update":{"$set":{"a":1}}}',
    want: { kind: 'updateMany', targets: ['users'], filterPresent: false, writes: true, risk: 'destructive', issues: ['no filter'] },
    summary: 'Updates all documents in `users`.',
  },
  {
    name: 'updateMany with filter and $set is a write',
    driver: 'mongodb',
    text: '{"operation":"updateMany","collection":"users","filter":{"active":false},"update":{"$set":{"a":1}}}',
    want: { kind: 'updateMany', targets: ['users'], filterPresent: true, writes: true, risk: 'write', issues: [] },
    summary: 'Updates documents in `users` where ….',
  },
  {
    name: 'update without operators is a full document replacement',
    driver: 'mongodb',
    text: '{"operation":"updateOne","collection":"users","filter":{"a":1},"update":{"b":2}}',
    want: {
      kind: 'updateOne',
      targets: ['users'],
      filterPresent: true,
      writes: true,
      risk: 'destructive',
      issues: ['full document replacement'],
    },
    summaryIncludes: 'Updates 1 document in `users`',
  },
  {
    name: 'replaceOne is a full document replacement',
    driver: 'mongodb',
    text: '{"operation":"replaceOne","collection":"users","filter":{"a":1},"document":{"b":2}}',
    want: {
      kind: 'replaceOne',
      targets: ['users'],
      filterPresent: true,
      writes: true,
      risk: 'destructive',
      issues: ['full document replacement'],
    },
    summary: 'Replaces 1 document in `users` where ….',
  },
  {
    name: 'upsert is flagged',
    driver: 'mongodb',
    text: '{"operation":"updateOne","collection":"users","filter":{"a":1},"update":{"$set":{"b":1}},"upsert":true}',
    want: { kind: 'updateOne', targets: ['users'], filterPresent: true, writes: true, risk: 'write', issues: ['upsert'] },
  },
  {
    name: 'dropCollection is destructive',
    driver: 'mongodb',
    text: '{"operation":"dropCollection","collection":"users"}',
    want: { kind: 'dropCollection', targets: ['users'], filterPresent: false, writes: true, risk: 'destructive', issues: [] },
    summary: 'Drops collection `users`.',
  },
  {
    name: 'deleteMany without filter is destructive',
    driver: 'mongodb',
    text: '{"operation":"deleteMany","collection":"users"}',
    want: { kind: 'deleteMany', targets: ['users'], filterPresent: false, writes: true, risk: 'destructive', issues: ['no filter'] },
    summary: 'Deletes all documents from `users`.',
  },
  {
    name: 'aggregate with $out writes and is destructive',
    driver: 'mongodb',
    text: '{"operation":"aggregate","collection":"users","pipeline":[{"$group":{"_id":"$a"}},{"$out":"report"}]}',
    want: {
      kind: 'aggregate',
      targets: ['users'],
      filterPresent: false,
      writes: true,
      risk: 'destructive',
      issues: ['pipeline writes to a collection'],
    },
    summary: 'Aggregates documents from `users`.',
  },
  {
    name: 'insertOne',
    driver: 'mongodb',
    text: '{"operation":"insertOne","collection":"users","document":{"a":1}}',
    want: { kind: 'insertOne', targets: ['users'], filterPresent: false, writes: true, risk: 'write', issues: [] },
    summary: 'Inserts 1 document into `users`.',
  },
  {
    name: 'unknown operation is treated conservatively',
    driver: 'mongodb',
    text: '{"operation":"dropEverything","collection":"users"}',
    want: {
      kind: 'unknown',
      targets: ['users'],
      filterPresent: false,
      writes: true,
      risk: 'write',
      issues: ['unknown operation `dropEverything`'],
    },
    summary: 'Could not understand this query.',
  },
  {
    name: 'invalid JSON is treated conservatively',
    driver: 'mongodb',
    text: 'not json',
    want: { kind: 'unknown', targets: [], filterPresent: false, writes: true, risk: 'write', issues: ['invalid JSON'] },
    summary: 'Could not understand this query.',
  },
  {
    name: 'unknown collection is flagged',
    driver: 'mongodb',
    text: '{"operation":"find","collection":"utenti"}',
    schema: { collections: [{ name: 'users' }] },
    want: {
      kind: 'find',
      targets: ['utenti'],
      filterPresent: false,
      writes: false,
      risk: 'read',
      issues: ['unknown collection `utenti`'],
    },
  },
  {
    name: 'unknown field is flagged',
    driver: 'mongodb',
    text: '{"operation":"find","collection":"users","filter":{"statoo":"x"}}',
    schema: { collections: [{ name: 'users', columns: ['name', 'age'] }] },
    want: {
      kind: 'find',
      targets: ['users'],
      filterPresent: true,
      writes: false,
      risk: 'read',
      issues: ['unknown column `statoo`'],
    },
  },
  {
    name: 'unindexed filter field on a large collection is flagged',
    driver: 'mongodb',
    text: '{"operation":"find","collection":"users","filter":{"age":{"$gt":3}}}',
    schema: { collections: [{ name: 'users', columns: ['name', 'age'], indexes: ['name'] }] },
    want: {
      kind: 'find',
      targets: ['users'],
      filterPresent: true,
      writes: false,
      risk: 'read',
      issues: ['unindexed field on a large collection'],
    },
  },
]

describe('interpret — MongoDB', () => {
  it.each(mongoCases)('$name', (c) => expectCase(c))
})

// ── interpret: Redis ─────────────────────────────────────────────────────────

const redisCases: InterpretCase[] = [
  {
    name: 'GET is a read',
    driver: 'redis',
    text: '{"command":"GET","args":["mykey"]}',
    want: { kind: 'get', targets: ['mykey'], filterPresent: true, writes: false, risk: 'read', issues: [] },
    summary: 'Reads `mykey`.',
  },
  {
    name: 'SET is a write',
    driver: 'redis',
    text: '{"command":"SET","args":["mykey","v"]}',
    want: { kind: 'set', targets: ['mykey'], filterPresent: true, writes: true, risk: 'write', issues: [] },
    summary: 'Writes `mykey`.',
  },
  {
    name: 'DEL lists every key',
    driver: 'redis',
    text: '{"command":"DEL","args":["k1","k2"]}',
    want: { kind: 'del', targets: ['k1', 'k2'], filterPresent: true, writes: true, risk: 'write', issues: [] },
    summary: 'Deletes `k1`, `k2`.',
  },
  {
    name: 'FLUSHDB is destructive without a filter',
    driver: 'redis',
    text: '{"command":"FLUSHDB"}',
    want: { kind: 'flushdb', targets: [], filterPresent: false, writes: true, risk: 'destructive', issues: ['no filter'] },
    summary: 'Deletes every key in the current database.',
  },
  {
    name: 'scan with pattern is a read',
    driver: 'redis',
    text: '{"operation":"scan","pattern":"user:*"}',
    want: { kind: 'scan', targets: ['user:*'], filterPresent: true, writes: false, risk: 'read', issues: [] },
    summary: 'Scans keys matching `user:*`.',
  },
  {
    name: 'scan without pattern covers the whole keyspace',
    driver: 'redis',
    text: '{"operation":"scan"}',
    want: { kind: 'scan', targets: ['*'], filterPresent: false, writes: false, risk: 'read', issues: [] },
    summary: 'Scans keys matching `*`.',
  },
  {
    name: 'inspect reads one key',
    driver: 'redis',
    text: '{"operation":"inspect","key":"mykey"}',
    want: { kind: 'inspect', targets: ['mykey'], filterPresent: true, writes: false, risk: 'read', issues: [] },
    summary: 'Reads the value of `mykey`.',
  },
  {
    name: 'unknown command is treated conservatively',
    driver: 'redis',
    text: '{"command":"FOO","args":["k"]}',
    want: {
      kind: 'unknown',
      targets: ['k'],
      filterPresent: true,
      writes: true,
      risk: 'write',
      issues: ['unknown command `FOO`'],
    },
  },
]

describe('interpret — Redis', () => {
  it.each(redisCases)('$name', (c) => expectCase(c))
})

// ── splitStatements ──────────────────────────────────────────────────────────

interface SplitCase {
  name: string
  text: string
  want: string[]
}

const splitCases: SplitCase[] = [
  { name: 'splits on semicolons', text: 'SELECT 1; SELECT 2', want: ['SELECT 1', 'SELECT 2'] },
  { name: 'keeps semicolons inside strings', text: "SELECT 'a;b'", want: ["SELECT 'a;b'"] },
  {
    name: 'keeps semicolons inside line comments',
    text: 'SELECT 1 -- x;y\n; SELECT 2',
    want: ['SELECT 1 -- x;y', 'SELECT 2'],
  },
  {
    name: 'keeps semicolons inside block comments',
    text: '/* a;b */ SELECT 1; SELECT 2',
    want: ['/* a;b */ SELECT 1', 'SELECT 2'],
  },
  {
    name: 'keeps semicolons inside $$ bodies',
    text: 'CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$; SELECT 1',
    want: ['CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$', 'SELECT 1'],
  },
  { name: 'drops comment-only statements', text: 'SELECT 1; -- done', want: ['SELECT 1'] },
  { name: 'empty text has no statements', text: '', want: [] },
]

describe('splitStatements', () => {
  it.each(splitCases)('$name', ({ text, want }) => {
    expect(splitStatements(text)).toEqual(want)
  })
})

// ── statementAt ──────────────────────────────────────────────────────────────

interface StatementAtCase {
  name: string
  text: string
  caret: number
  want: { text: string; start: number; end: number } | null
}

const statementAtCases: StatementAtCase[] = [
  {
    name: 'caret inside the first statement',
    text: 'SELECT 1; SELECT 2',
    caret: 3,
    want: { text: 'SELECT 1', start: 0, end: 8 },
  },
  {
    name: 'caret inside the second statement',
    text: 'SELECT 1; SELECT 2',
    caret: 12,
    want: { text: 'SELECT 2', start: 10, end: 18 },
  },
  {
    name: 'caret on the semicolon belongs to the statement before',
    text: 'SELECT 1; SELECT 2',
    caret: 8,
    want: { text: 'SELECT 1', start: 0, end: 8 },
  },
  {
    name: 'caret before the first statement belongs to the first one',
    text: '  SELECT 1; SELECT 2',
    caret: 0,
    want: { text: 'SELECT 1', start: 2, end: 10 },
  },
  { name: 'no statement at all', text: '-- nothing here', caret: 4, want: null },
]

describe('statementAt', () => {
  it.each(statementAtCases)('$name', ({ text, caret, want }) => {
    expect(statementAt(text, caret)).toEqual(want)
  })
})

// ── countRewrite ─────────────────────────────────────────────────────────────

interface RewriteCase {
  name: string
  driver: DbKind
  text: string
  want: string | null
}

const rewriteCases: RewriteCase[] = [
  {
    name: 'update with WHERE',
    driver: 'postgres',
    text: 'UPDATE utenti SET a = 1 WHERE id = 2',
    want: 'SELECT COUNT(*) FROM utenti WHERE id = 2',
  },
  {
    name: 'mysql quoted table keeps its quoting',
    driver: 'mysql',
    text: 'UPDATE `utenti` SET a = 1 WHERE id = 2',
    want: 'SELECT COUNT(*) FROM `utenti` WHERE id = 2',
  },
  {
    name: 'delete without WHERE counts the whole table',
    driver: 'sqlite',
    text: 'DELETE FROM utenti',
    want: 'SELECT COUNT(*) FROM utenti',
  },
  {
    name: 'delete with a subquery is not rewritten',
    driver: 'postgres',
    text: 'DELETE FROM utenti WHERE id IN (SELECT id FROM ordini)',
    want: null,
  },
  {
    name: 'delete with LIMIT is not rewritten',
    driver: 'mysql',
    text: 'DELETE FROM utenti WHERE id = 1 LIMIT 5',
    want: null,
  },
  { name: 'select is not rewritten', driver: 'postgres', text: 'SELECT * FROM utenti', want: null },
  {
    name: 'multiple statements are not rewritten',
    driver: 'postgres',
    text: 'UPDATE utenti SET a = 1 WHERE id = 2; SELECT 1',
    want: null,
  },
  {
    name: 'update with JOIN is not rewritten',
    driver: 'postgres',
    text: 'UPDATE utenti u JOIN ordini o ON o.uid = u.id SET u.a = 1 WHERE u.id = 2',
    want: null,
  },
  {
    name: 'mongo updateMany becomes a count command',
    driver: 'mongodb',
    text: '{"operation":"updateMany","collection":"users","filter":{"a":1}}',
    want: '{"operation":"count","collection":"users","filter":{"a":1}}',
  },
  {
    name: 'mongo deleteMany becomes a count command',
    driver: 'mongodb',
    text: '{"operation":"deleteMany","collection":"users","filter":{"a":1}}',
    want: '{"operation":"count","collection":"users","filter":{"a":1}}',
  },
  { name: 'mongo find is not rewritten', driver: 'mongodb', text: '{"operation":"find","collection":"users"}', want: null },
  { name: 'redis is never rewritten', driver: 'redis', text: '{"command":"GET","args":["k"]}', want: null },
]

describe('countRewrite', () => {
  it.each(rewriteCases)('$name', ({ driver, text, want }) => {
    expect(countRewrite(driver, text)).toBe(want)
  })
})

describe('data-modifying CTE', () => {
  it('sees the write hidden inside the parentheses', () => {
    expect(interpret('postgres', 'WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d')).toMatchObject({ kind: 'delete', risk: 'destructive', filterPresent: false })
    expect(interpret('postgres', 'WITH d AS (DELETE FROM users WHERE id = 1 RETURNING *) SELECT * FROM d')).toMatchObject({ kind: 'delete', risk: 'write', filterPresent: true })
    expect(countRewrite('postgres', 'WITH d AS (DELETE FROM users WHERE id = 1 RETURNING *) SELECT * FROM d')).toBeNull()
  })

  it('leaves a plain read-only CTE alone', () => {
    expect(interpret('postgres', 'WITH x AS (SELECT 1) SELECT * FROM x')).toMatchObject({ kind: 'select', risk: 'read' })
  })

  it('does not take a quoted identifier named where for a filter', () => {
    expect(interpret('postgres', 'UPDATE t SET "where" = 1').filterPresent).toBe(false)
  })
})
