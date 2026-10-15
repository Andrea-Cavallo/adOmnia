/**
 * Query templates for the database console (FIX.md DB-3.1.2).
 *
 * Pure data: no React, no logic beyond `templatesFor()`. Bodies use the snippet
 * syntax of `snippet.ts` (`${1:default}`, `${2|a,b|}`, `$0`, `\$` for a literal
 * dollar). Mongo and Redis bodies are the JSON documents the Go runner expects
 * (`database.go` `mongoQueryCommand`, `redis.go` `redisQuery`); SQL bodies are
 * single statements.
 */

import { STAGE_OPERATORS } from './mongo/AggregationsTab'

export type ConsoleCategory = 'search' | 'insert' | 'update' | 'delete' | 'aggregate' | 'schema'
export type TemplateRisk = 'read' | 'write' | 'destructive'

export interface ConsoleTemplate {
  id: string
  driver: 'mongodb' | 'postgres' | 'mysql' | 'sqlite' | 'redis'
  category: ConsoleCategory
  title: string
  description: string
  /** Query text in snippet syntax: ${1:placeholder}, ${2|a,b|}, $0. */
  body: string
  risk: TemplateRisk
}

export const TEMPLATE_CATEGORIES: { id: ConsoleCategory; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'insert', label: 'Insert' },
  { id: 'update', label: 'Update' },
  { id: 'delete', label: 'Delete' },
  { id: 'aggregate', label: 'Aggregate' },
  { id: 'schema', label: 'Schema & admin' },
]

// Aggregation stage operators come from the aggregation builder
// (mongo/AggregationsTab) so both surfaces stay in sync (FIX.md DB-3.1.2:
// imported, not copied). STAGE_TEMPLATES over there is a module-local const and
// not exported, so the pipeline bodies below are written fresh in snippet
// syntax instead of duplicating its literals.
const STAGE_CHOICES = STAGE_OPERATORS.join(',')

export const CONSOLE_TEMPLATES: ConsoleTemplate[] = [
  // ---------------------------------------------------------------- MongoDB
  {
    id: 'mongo-find', driver: 'mongodb', category: 'search', risk: 'read',
    title: 'Find documents',
    description: 'Read a capped set of documents from a collection.',
    body: '{\n  "operation": "find",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": {$0},\n  "limit": 20\n}',
  },
  {
    id: 'mongo-find-filter', driver: 'mongodb', category: 'search', risk: 'read',
    title: 'Find with filter and projection',
    description: 'Read documents matching one field, returning only the fields you need.',
    body: '{\n  "operation": "find",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": { "${3:field}": "${4:value}" },\n  "projection": { "${5:field}": 1 },\n  "limit": ${6|20,50,100|}\n}',
  },
  {
    id: 'mongo-find-sort', driver: 'mongodb', category: 'search', risk: 'read',
    title: 'Find with sort and limit',
    description: 'Read documents ordered by one field, newest or largest first.',
    body: '{\n  "operation": "find",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": {$0},\n  "sort": { "${3:field}": ${4|-1,1|} },\n  "limit": ${5|20,50,100|}\n}',
  },
  {
    id: 'mongo-count', driver: 'mongodb', category: 'search', risk: 'read',
    title: 'Count documents',
    description: 'Count the documents matching a filter without returning them.',
    body: '{\n  "operation": "count",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": {$0}\n}',
  },
  {
    id: 'mongo-insert-one', driver: 'mongodb', category: 'insert', risk: 'write',
    title: 'Insert one document',
    description: 'Add a single document to a collection.',
    body: '{\n  "operation": "insertOne",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "document": { "${3:field}": "${4:value}"$0 }\n}',
  },
  {
    id: 'mongo-insert-many', driver: 'mongodb', category: 'insert', risk: 'write',
    title: 'Insert many documents',
    description: 'Add several documents to a collection in one run.',
    body: '{\n  "operation": "insertMany",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "documents": [\n    { "${3:field}": "${4:value}" },\n    { "${5:field}": "${6:value}" }$0\n  ]\n}',
  },
  {
    id: 'mongo-update-one-set', driver: 'mongodb', category: 'update', risk: 'write',
    title: 'Update one document ($set)',
    description: 'Change one field of the first document matching the filter.',
    body: '{\n  "operation": "updateOne",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": { "${3:field}": "${4:value}" },\n  "update": { "$set": { "${5:field}": "${6:value}" } }\n}',
  },
  {
    id: 'mongo-update-many-set', driver: 'mongodb', category: 'update', risk: 'write',
    title: 'Update many documents ($set)',
    description: 'Set one field on every document matching the filter.',
    body: '{\n  "operation": "updateMany",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": { "${3:field}": "${4:value}" },\n  "update": { "$set": { "${5:field}": "${6:value}" } }\n}',
  },
  {
    id: 'mongo-update-many-inc', driver: 'mongodb', category: 'update', risk: 'write',
    title: 'Update many documents ($inc)',
    description: 'Increment or decrement a numeric field on every matching document.',
    body: '{\n  "operation": "updateMany",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": { "${3:field}": "${4:value}" },\n  "update": { "$inc": { "${5:field}": ${6|1,-1|} } }\n}',
  },
  {
    id: 'mongo-update-many-unset', driver: 'mongodb', category: 'update', risk: 'write',
    title: 'Update many documents ($unset)',
    description: 'Remove a field from every document matching the filter.',
    body: '{\n  "operation": "updateMany",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": { "${3:field}": "${4:value}" },\n  "update": { "$unset": { "${5:field}": "" } }\n}',
  },
  {
    id: 'mongo-update-many-push', driver: 'mongodb', category: 'update', risk: 'write',
    title: 'Update many documents ($push)',
    description: 'Append a value to an array field on every matching document.',
    body: '{\n  "operation": "updateMany",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": { "${3:field}": "${4:value}" },\n  "update": { "$push": { "${5:field}": "${6:value}" } }\n}',
  },
  {
    id: 'mongo-replace-one', driver: 'mongodb', category: 'update', risk: 'write',
    title: 'Replace one document',
    description: 'Swap the whole content of one document; the filter picks which one.',
    body: '{\n  "operation": "replaceOne",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": { "${3:field}": "${4:value}" },\n  "document": { "${5:field}": "${6:value}" },\n  "upsert": ${7|false,true|}\n}',
  },
  {
    id: 'mongo-delete-one', driver: 'mongodb', category: 'delete', risk: 'destructive',
    title: 'Delete one document',
    description: 'Remove the first document matching the filter.',
    body: '{\n  "operation": "deleteOne",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": { "${3:field}": "${4:value}" }\n}',
  },
  {
    id: 'mongo-delete-many', driver: 'mongodb', category: 'delete', risk: 'destructive',
    title: 'Delete many documents',
    description: 'Remove every document matching the filter.',
    body: '{\n  "operation": "deleteMany",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "filter": { "${3:field}": "${4:value}" }\n}',
  },
  {
    id: 'mongo-aggregate-group', driver: 'mongodb', category: 'aggregate', risk: 'read',
    title: 'Aggregate: filter, group, sort',
    description: 'Group documents by one field, count each group and sort by the total.',
    body: '{\n  "operation": "aggregate",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "pipeline": [\n    { "$match": { "${3:field}": "${4:value}" } },\n    { "$group": { "_id": "${5:group_field}", "${6:total}": { "$sum": ${7:1} } } },\n    { "$sort": { "${6:total}": ${8|-1,1|} } }\n  ],\n  "limit": ${9|20,50,100|}\n}',
  },
  {
    id: 'mongo-aggregate-lookup', driver: 'mongodb', category: 'aggregate', risk: 'read',
    title: 'Aggregate: join with $lookup',
    description: 'Join documents from another collection and flatten the joined array.',
    body: '{\n  "operation": "aggregate",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "pipeline": [\n    { "$lookup": { "from": "${3:other}", "localField": "${4:foreign_key}", "foreignField": "${5:_id}", "as": "${6:joined}" } },\n    { "$unwind": "${7:$joined}" },\n    { "$limit": ${8|20,50,100|} }\n  ]\n}',
  },
  {
    id: 'mongo-aggregate-stage', driver: 'mongodb', category: 'aggregate', risk: 'read',
    title: 'Aggregate: single custom stage',
    description: 'Start a pipeline with one stage of your choice and fill in its body.',
    body: '{\n  "operation": "aggregate",\n  "database": "${1:db}",\n  "collection": "${2:collection}",\n  "pipeline": [\n    { "${3|' + STAGE_CHOICES + '|}": {$0} }\n  ],\n  "limit": ${4|20,50,100|}\n}',
  },
  {
    id: 'mongo-create-collection', driver: 'mongodb', category: 'schema', risk: 'write',
    title: 'Create collection',
    description: 'Create an empty collection in a database.',
    body: '{\n  "operation": "createCollection",\n  "database": "${1:db}",\n  "collection": "${2:collection}"\n}',
  },
  {
    id: 'mongo-drop-collection', driver: 'mongodb', category: 'schema', risk: 'destructive',
    title: 'Drop collection',
    description: 'Delete a collection and all of its documents.',
    body: '{\n  "operation": "dropCollection",\n  "database": "${1:db}",\n  "collection": "${2:collection}"\n}',
  },
  {
    id: 'mongo-create-indexes', driver: 'mongodb', category: 'schema', risk: 'write',
    title: 'Create index (runCommand)',
    description: 'Create an index on one field through the createIndexes command.',
    body: '{\n  "operation": "runCommand",\n  "database": "${1:db}",\n  "command": {\n    "createIndexes": "${2:collection}",\n    "indexes": [\n      { "key": { "${3:field}": 1 }, "name": "${4:index_name}" }\n    ]\n  }\n}',
  },
  {
    id: 'mongo-list-indexes', driver: 'mongodb', category: 'schema', risk: 'read',
    title: 'List indexes (runCommand)',
    description: 'List the indexes of a collection through the listIndexes command.',
    body: '{\n  "operation": "runCommand",\n  "database": "${1:db}",\n  "command": { "listIndexes": "${2:collection}" }\n}',
  },
  {
    id: 'mongo-drop-indexes', driver: 'mongodb', category: 'schema', risk: 'destructive',
    title: 'Drop index (runCommand)',
    description: 'Remove one index from a collection through the dropIndexes command.',
    body: '{\n  "operation": "runCommand",\n  "database": "${1:db}",\n  "command": { "dropIndexes": "${2:collection}", "index": "${3:index_name}" }\n}',
  },

  // ------------------------------------------------------------------- Redis
  {
    id: 'redis-get', driver: 'redis', category: 'search', risk: 'read',
    title: 'GET key',
    description: 'Read the string value stored at a key.',
    body: '{"command": "GET", "args": ["${1:key}"]}',
  },
  {
    id: 'redis-ttl', driver: 'redis', category: 'search', risk: 'read',
    title: 'TTL key',
    description: 'Read how many seconds are left before a key expires.',
    body: '{"command": "TTL", "args": ["${1:key}"]}',
  },
  {
    id: 'redis-hgetall', driver: 'redis', category: 'search', risk: 'read',
    title: 'HGETALL key',
    description: 'Read every field and value of a hash.',
    body: '{"command": "HGETALL", "args": ["${1:key}"]}',
  },
  {
    id: 'redis-lrange', driver: 'redis', category: 'search', risk: 'read',
    title: 'LRANGE key',
    description: 'Read a range of elements from a list, 0 to -1 for the whole list.',
    body: '{"command": "LRANGE", "args": ["${1:key}", "${2:0}", "${3:-1}"]}',
  },
  {
    id: 'redis-smembers', driver: 'redis', category: 'search', risk: 'read',
    title: 'SMEMBERS key',
    description: 'Read every member of a set.',
    body: '{"command": "SMEMBERS", "args": ["${1:key}"]}',
  },
  {
    id: 'redis-scan', driver: 'redis', category: 'search', risk: 'read',
    title: 'Scan keys by pattern',
    description: 'List the keys matching a glob pattern without blocking the server.',
    body: '{"operation": "scan", "pattern": "${1:*}"}',
  },
  {
    id: 'redis-inspect', driver: 'redis', category: 'search', risk: 'read',
    title: 'Inspect a key',
    description: 'Show the type, TTL and previewed value of one key.',
    body: '{"operation": "inspect", "key": "${1:key}"}',
  },
  {
    id: 'redis-set', driver: 'redis', category: 'update', risk: 'write',
    title: 'SET key value',
    description: 'Write a string value at a key, creating or overwriting it.',
    body: '{"command": "SET", "args": ["${1:key}", "${2:value}"]}',
  },
  {
    id: 'redis-set-ex', driver: 'redis', category: 'update', risk: 'write',
    title: 'SET key value EX seconds',
    description: 'Write a string value that expires after the given seconds.',
    body: '{"command": "SET", "args": ["${1:key}", "${2:value}", "EX", "${3|60,300,3600|}"]}',
  },
  {
    id: 'redis-hset', driver: 'redis', category: 'update', risk: 'write',
    title: 'HSET key field value',
    description: 'Write one field of a hash, creating the hash when missing.',
    body: '{"command": "HSET", "args": ["${1:key}", "${2:field}", "${3:value}"]}',
  },
  {
    id: 'redis-expire', driver: 'redis', category: 'update', risk: 'write',
    title: 'EXPIRE key seconds',
    description: 'Set or replace the expiry of an existing key.',
    body: '{"command": "EXPIRE", "args": ["${1:key}", "${2|60,300,3600|}"]}',
  },
  {
    id: 'redis-lpush', driver: 'redis', category: 'insert', risk: 'write',
    title: 'LPUSH key value',
    description: 'Prepend a value to a list, creating the list when missing.',
    body: '{"command": "LPUSH", "args": ["${1:key}", "${2:value}"]}',
  },
  {
    id: 'redis-sadd', driver: 'redis', category: 'insert', risk: 'write',
    title: 'SADD key member',
    description: 'Add a member to a set, creating the set when missing.',
    body: '{"command": "SADD", "args": ["${1:key}", "${2:member}"]}',
  },
  {
    id: 'redis-del', driver: 'redis', category: 'delete', risk: 'destructive',
    title: 'DEL key',
    description: 'Delete a key and everything stored at it.',
    body: '{"command": "DEL", "args": ["${1:key}"]}',
  },

  // --------------------------------------------------------------------- SQL
  // No TOP variant: the supported SQL drivers all use LIMIT (TOP is SQL Server
  // only). RETURNING is covered for postgres and sqlite; ON CONFLICT for
  // postgres and sqlite, ON DUPLICATE KEY for mysql.

  // -- postgres
  {
    id: 'sql-postgres-select', driver: 'postgres', category: 'search', risk: 'read',
    title: 'Select rows',
    description: 'Read rows from one table, filtered and capped by a limit.',
    body: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:id} = ${4:value}\nLIMIT ${5:100};',
  },
  {
    id: 'sql-postgres-select-join', driver: 'postgres', category: 'search', risk: 'read',
    title: 'Select with join',
    description: 'Read rows from two tables joined on a shared column.',
    body: 'SELECT ${1:a.*}, ${2:b.name}\nFROM ${3:table_a} AS ${4:a}\nJOIN ${5:table_b} AS ${6:b} ON ${4:a}.${7:id} = ${6:b}.${8:a_id}\nWHERE ${4:a}.${9:status} = ${10:value}\nLIMIT ${11:100};',
  },
  {
    id: 'sql-postgres-select-group', driver: 'postgres', category: 'search', risk: 'read',
    title: 'Select with group by',
    description: 'Count rows per value of one column and filter on the count.',
    body: 'SELECT ${1:category}, COUNT(*) AS ${2:total}\nFROM ${3:table}\nGROUP BY ${1:category}\nHAVING COUNT(*) > ${4:1}\nORDER BY ${2:total} DESC\nLIMIT ${5:100};',
  },
  {
    id: 'sql-postgres-with', driver: 'postgres', category: 'search', risk: 'read',
    title: 'Select with CTE',
    description: 'Compute a named subquery first, then read from it.',
    body: 'WITH ${1:cte} AS (\n  SELECT ${2:*}\n  FROM ${3:table}\n  WHERE ${4:id} = ${5:value}\n)\nSELECT ${6:*}\nFROM ${1:cte}\nLIMIT ${7:100};',
  },
  {
    id: 'sql-postgres-insert', driver: 'postgres', category: 'insert', risk: 'write',
    title: 'Insert a row',
    description: 'Add one row to a table.',
    body: 'INSERT INTO ${1:table} (${2:column}, ${3:column2})\nVALUES (${4:value}, ${5:value2});',
  },
  {
    id: 'sql-postgres-insert-upsert', driver: 'postgres', category: 'insert', risk: 'write',
    title: 'Insert a row (upsert)',
    description: 'Add one row, or update it when the key already exists.',
    body: 'INSERT INTO ${1:table} (${2:column}, ${3:column2})\nVALUES (${4:value}, ${5:value2})\nON CONFLICT (${2:column}) DO UPDATE SET ${3:column2} = ${5:value2};',
  },
  {
    id: 'sql-postgres-update', driver: 'postgres', category: 'update', risk: 'write',
    title: 'Update rows',
    description: 'Change one column of the rows matching the where clause.',
    body: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:id} = ${5:value};',
  },
  {
    id: 'sql-postgres-update-returning', driver: 'postgres', category: 'update', risk: 'write',
    title: 'Update rows (returning)',
    description: 'Change one column and return the updated rows.',
    body: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:id} = ${5:value}\nRETURNING ${6:*};',
  },
  {
    id: 'sql-postgres-delete', driver: 'postgres', category: 'delete', risk: 'destructive',
    title: 'Delete rows',
    description: 'Remove the rows matching the where clause.',
    body: 'DELETE FROM ${1:table}\nWHERE ${2:id} = ${3:value};',
  },
  {
    id: 'sql-postgres-delete-returning', driver: 'postgres', category: 'delete', risk: 'destructive',
    title: 'Delete rows (returning)',
    description: 'Remove the rows matching the where clause and return them.',
    body: 'DELETE FROM ${1:table}\nWHERE ${2:id} = ${3:value}\nRETURNING *;',
  },
  {
    id: 'sql-postgres-create-table', driver: 'postgres', category: 'schema', risk: 'write',
    title: 'Create table',
    description: 'Create a table with a primary key and two columns.',
    body: 'CREATE TABLE ${1:table} (\n  ${2:id} ${3|INTEGER,BIGINT,TEXT,VARCHAR(255)|} PRIMARY KEY,\n  ${4:name} ${5|TEXT,VARCHAR(255),INTEGER,BOOLEAN,NUMERIC|} ${6|NOT NULL,DEFAULT NULL|},\n  created_at ${7|TIMESTAMP,TEXT|} NOT NULL\n);',
  },
  {
    id: 'sql-postgres-alter-table', driver: 'postgres', category: 'schema', risk: 'write',
    title: 'Alter table: add a column',
    description: 'Add a new column to an existing table.',
    body: 'ALTER TABLE ${1:table}\nADD COLUMN ${2:column} ${3|TEXT,VARCHAR(255),INTEGER,BOOLEAN,NUMERIC|} ${4|NOT NULL,DEFAULT NULL|};',
  },
  {
    id: 'sql-postgres-create-index', driver: 'postgres', category: 'schema', risk: 'write',
    title: 'Create index',
    description: 'Create an index on one column of a table.',
    body: 'CREATE ${1|INDEX,UNIQUE INDEX|} ${2:index_name}\nON ${3:table} (${4:column});',
  },
  {
    id: 'sql-postgres-drop', driver: 'postgres', category: 'schema', risk: 'destructive',
    title: 'Drop table or index',
    description: 'Delete a table or an index and its data.',
    body: 'DROP ${1|TABLE,INDEX|} ${2:name};',
  },

  // -- mysql
  {
    id: 'sql-mysql-select', driver: 'mysql', category: 'search', risk: 'read',
    title: 'Select rows',
    description: 'Read rows from one table, filtered and capped by a limit.',
    body: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:id} = ${4:value}\nLIMIT ${5:100};',
  },
  {
    id: 'sql-mysql-select-join', driver: 'mysql', category: 'search', risk: 'read',
    title: 'Select with join',
    description: 'Read rows from two tables joined on a shared column.',
    body: 'SELECT ${1:a.*}, ${2:b.name}\nFROM ${3:table_a} AS ${4:a}\nJOIN ${5:table_b} AS ${6:b} ON ${4:a}.${7:id} = ${6:b}.${8:a_id}\nWHERE ${4:a}.${9:status} = ${10:value}\nLIMIT ${11:100};',
  },
  {
    id: 'sql-mysql-select-group', driver: 'mysql', category: 'search', risk: 'read',
    title: 'Select with group by',
    description: 'Count rows per value of one column and filter on the count.',
    body: 'SELECT ${1:category}, COUNT(*) AS ${2:total}\nFROM ${3:table}\nGROUP BY ${1:category}\nHAVING COUNT(*) > ${4:1}\nORDER BY ${2:total} DESC\nLIMIT ${5:100};',
  },
  {
    id: 'sql-mysql-with', driver: 'mysql', category: 'search', risk: 'read',
    title: 'Select with CTE',
    description: 'Compute a named subquery first, then read from it.',
    body: 'WITH ${1:cte} AS (\n  SELECT ${2:*}\n  FROM ${3:table}\n  WHERE ${4:id} = ${5:value}\n)\nSELECT ${6:*}\nFROM ${1:cte}\nLIMIT ${7:100};',
  },
  {
    id: 'sql-mysql-insert', driver: 'mysql', category: 'insert', risk: 'write',
    title: 'Insert a row',
    description: 'Add one row to a table.',
    body: 'INSERT INTO ${1:table} (${2:column}, ${3:column2})\nVALUES (${4:value}, ${5:value2});',
  },
  {
    id: 'sql-mysql-insert-upsert', driver: 'mysql', category: 'insert', risk: 'write',
    title: 'Insert a row (upsert)',
    description: 'Add one row, or update it when the key already exists.',
    body: 'INSERT INTO ${1:table} (${2:column}, ${3:column2})\nVALUES (${4:value}, ${5:value2})\nON DUPLICATE KEY UPDATE ${3:column2} = ${5:value2};',
  },
  {
    id: 'sql-mysql-update', driver: 'mysql', category: 'update', risk: 'write',
    title: 'Update rows',
    description: 'Change one column of the rows matching the where clause.',
    body: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:id} = ${5:value};',
  },
  {
    id: 'sql-mysql-delete', driver: 'mysql', category: 'delete', risk: 'destructive',
    title: 'Delete rows',
    description: 'Remove the rows matching the where clause.',
    body: 'DELETE FROM ${1:table}\nWHERE ${2:id} = ${3:value};',
  },
  {
    id: 'sql-mysql-create-table', driver: 'mysql', category: 'schema', risk: 'write',
    title: 'Create table',
    description: 'Create a table with a primary key and two columns.',
    body: 'CREATE TABLE ${1:table} (\n  ${2:id} ${3|INTEGER,BIGINT,TEXT,VARCHAR(255)|} PRIMARY KEY,\n  ${4:name} ${5|TEXT,VARCHAR(255),INTEGER,BOOLEAN,NUMERIC|} ${6|NOT NULL,DEFAULT NULL|},\n  created_at ${7|TIMESTAMP,DATETIME|} NOT NULL\n);',
  },
  {
    id: 'sql-mysql-alter-table', driver: 'mysql', category: 'schema', risk: 'write',
    title: 'Alter table: add a column',
    description: 'Add a new column to an existing table.',
    body: 'ALTER TABLE ${1:table}\nADD COLUMN ${2:column} ${3|TEXT,VARCHAR(255),INTEGER,BOOLEAN,NUMERIC|} ${4|NOT NULL,DEFAULT NULL|};',
  },
  {
    id: 'sql-mysql-create-index', driver: 'mysql', category: 'schema', risk: 'write',
    title: 'Create index',
    description: 'Create an index on one column of a table.',
    body: 'CREATE ${1|INDEX,UNIQUE INDEX|} ${2:index_name}\nON ${3:table} (${4:column});',
  },
  {
    id: 'sql-mysql-drop', driver: 'mysql', category: 'schema', risk: 'destructive',
    title: 'Drop table or index',
    description: 'Delete a table or an index and its data.',
    body: 'DROP ${1|TABLE,INDEX|} ${2:name};',
  },

  // -- sqlite
  {
    id: 'sql-sqlite-select', driver: 'sqlite', category: 'search', risk: 'read',
    title: 'Select rows',
    description: 'Read rows from one table, filtered and capped by a limit.',
    body: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:id} = ${4:value}\nLIMIT ${5:100};',
  },
  {
    id: 'sql-sqlite-select-join', driver: 'sqlite', category: 'search', risk: 'read',
    title: 'Select with join',
    description: 'Read rows from two tables joined on a shared column.',
    body: 'SELECT ${1:a.*}, ${2:b.name}\nFROM ${3:table_a} AS ${4:a}\nJOIN ${5:table_b} AS ${6:b} ON ${4:a}.${7:id} = ${6:b}.${8:a_id}\nWHERE ${4:a}.${9:status} = ${10:value}\nLIMIT ${11:100};',
  },
  {
    id: 'sql-sqlite-select-group', driver: 'sqlite', category: 'search', risk: 'read',
    title: 'Select with group by',
    description: 'Count rows per value of one column and filter on the count.',
    body: 'SELECT ${1:category}, COUNT(*) AS ${2:total}\nFROM ${3:table}\nGROUP BY ${1:category}\nHAVING COUNT(*) > ${4:1}\nORDER BY ${2:total} DESC\nLIMIT ${5:100};',
  },
  {
    id: 'sql-sqlite-with', driver: 'sqlite', category: 'search', risk: 'read',
    title: 'Select with CTE',
    description: 'Compute a named subquery first, then read from it.',
    body: 'WITH ${1:cte} AS (\n  SELECT ${2:*}\n  FROM ${3:table}\n  WHERE ${4:id} = ${5:value}\n)\nSELECT ${6:*}\nFROM ${1:cte}\nLIMIT ${7:100};',
  },
  {
    id: 'sql-sqlite-insert', driver: 'sqlite', category: 'insert', risk: 'write',
    title: 'Insert a row',
    description: 'Add one row to a table.',
    body: 'INSERT INTO ${1:table} (${2:column}, ${3:column2})\nVALUES (${4:value}, ${5:value2});',
  },
  {
    id: 'sql-sqlite-insert-upsert', driver: 'sqlite', category: 'insert', risk: 'write',
    title: 'Insert a row (upsert)',
    description: 'Add one row, or update it when the key already exists.',
    body: 'INSERT INTO ${1:table} (${2:column}, ${3:column2})\nVALUES (${4:value}, ${5:value2})\nON CONFLICT (${2:column}) DO UPDATE SET ${3:column2} = ${5:value2};',
  },
  {
    id: 'sql-sqlite-update', driver: 'sqlite', category: 'update', risk: 'write',
    title: 'Update rows',
    description: 'Change one column of the rows matching the where clause.',
    body: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:id} = ${5:value};',
  },
  {
    id: 'sql-sqlite-update-returning', driver: 'sqlite', category: 'update', risk: 'write',
    title: 'Update rows (returning)',
    description: 'Change one column and return the updated rows.',
    body: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:id} = ${5:value}\nRETURNING ${6:*};',
  },
  {
    id: 'sql-sqlite-delete', driver: 'sqlite', category: 'delete', risk: 'destructive',
    title: 'Delete rows',
    description: 'Remove the rows matching the where clause.',
    body: 'DELETE FROM ${1:table}\nWHERE ${2:id} = ${3:value};',
  },
  {
    id: 'sql-sqlite-delete-returning', driver: 'sqlite', category: 'delete', risk: 'destructive',
    title: 'Delete rows (returning)',
    description: 'Remove the rows matching the where clause and return them.',
    body: 'DELETE FROM ${1:table}\nWHERE ${2:id} = ${3:value}\nRETURNING *;',
  },
  {
    id: 'sql-sqlite-create-table', driver: 'sqlite', category: 'schema', risk: 'write',
    title: 'Create table',
    description: 'Create a table with a primary key and two columns.',
    body: 'CREATE TABLE ${1:table} (\n  ${2:id} ${3|INTEGER,BIGINT,TEXT,VARCHAR(255)|} PRIMARY KEY,\n  ${4:name} ${5|TEXT,VARCHAR(255),INTEGER,BOOLEAN,NUMERIC|} ${6|NOT NULL,DEFAULT NULL|},\n  created_at ${7|TIMESTAMP,TEXT|} NOT NULL\n);',
  },
  {
    id: 'sql-sqlite-alter-table', driver: 'sqlite', category: 'schema', risk: 'write',
    title: 'Alter table: add a column',
    description: 'Add a new column to an existing table.',
    body: 'ALTER TABLE ${1:table}\nADD COLUMN ${2:column} ${3|TEXT,VARCHAR(255),INTEGER,BOOLEAN,NUMERIC|} ${4|NOT NULL,DEFAULT NULL|};',
  },
  {
    id: 'sql-sqlite-create-index', driver: 'sqlite', category: 'schema', risk: 'write',
    title: 'Create index',
    description: 'Create an index on one column of a table.',
    body: 'CREATE ${1|INDEX,UNIQUE INDEX|} ${2:index_name}\nON ${3:table} (${4:column});',
  },
  {
    id: 'sql-sqlite-drop', driver: 'sqlite', category: 'schema', risk: 'destructive',
    title: 'Drop table or index',
    description: 'Delete a table or an index and its data.',
    body: 'DROP ${1|TABLE,INDEX|} ${2:name};',
  },
]

/** Templates of one driver, optionally narrowed to one category. */
export function templatesFor(driver: string, category?: ConsoleCategory): ConsoleTemplate[] {
  return CONSOLE_TEMPLATES.filter((t) => t.driver === driver && (category === undefined || t.category === category))
}

export interface TemplateContext {
  /** Table or collection the user is working on: precompiles the table/collection stop. */
  table?: string
  /** Columns or sampled fields of `table`: the first field/column stop becomes a choice list. */
  columns?: string[]
  /** Mongo database name: precompiles the `db` stop. */
  database?: string
}

const MAX_COLUMN_CHOICES = 20

/** Escapes text so it can sit inside a `${n:…}` placeholder of snippet.ts. */
function placeholderText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/\}/g, ')')
}

/**
 * Fills the schema-dependent stops of a template body. Stops stay tab stops (the user can still
 * overtype them); only their default text changes.
 */
export function specializeTemplate(body: string, ctx: TemplateContext): string {
  let out = body
  if (ctx.table) {
    const name = placeholderText(ctx.table)
    out = out.replace(/\$\{(\d+):(?:table|collection)\}/g, (_, n: string) => `\${${n}:${name}}`)
  }
  if (ctx.database) {
    const name = placeholderText(ctx.database)
    out = out.replace(/\$\{(\d+):db\}/g, (_, n: string) => `\${${n}:${name}}`)
  }
  const choices = (ctx.columns ?? []).filter((c) => c && !/[,|$\\}]/.test(c)).slice(0, MAX_COLUMN_CHOICES)
  if (choices.length > 1) {
    let done = false
    out = out.replace(/\$\{(\d+):(?:field|column)\}/, (whole, n: string) => {
      if (done) return whole
      done = true
      return `\${${n}|${choices.join(',')}|}`
    })
  }
  return out
}
