import { describe, expect, it } from 'vitest'
import { columnsQuery, formatSchema, formatTopic } from './goStudioAILiveContext'

describe('live AI context', () => {
  it('reads columns for each SQL driver', () => {
    expect(columnsQuery('postgres')).toContain("table_schema = 'public'")
    expect(columnsQuery('mysql')).toContain('DATABASE()')
    expect(columnsQuery('sqlite')).toContain('pragma_table_info')
    expect(columnsQuery('mongodb')).toBe('')
  })

  it('formats one line per table, code tables first when there are many', () => {
    const rows = [
      { table_name: 'orders', column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()' },
      { table_name: 'orders', column_name: 'note', data_type: 'text', is_nullable: 'YES', column_default: null },
      { TABLE_NAME: 'users', COLUMN_NAME: 'email', DATA_TYPE: 'varchar(255)', IS_NULLABLE: 'NO' },
    ]
    expect(formatSchema(rows, [])).toBe('- orders(id uuid NOT NULL DEFAULT gen_random_uuid(), note text)\n- users(email varchar(255) NOT NULL)')
    const many = Array.from({ length: 45 }, (_, index) => ({ table_name: `t${index}`, column_name: 'id', data_type: 'int', is_nullable: 'NO' }))
    const text = formatSchema(many, ['t44'])
    expect(text.split('\n')[0]).toBe('- t44(id int NOT NULL)')
    expect(text).toContain('… and 5 more tables')
  })

  it('summarises a topic without default or sensitive configs', () => {
    expect(formatTopic({
      topic: 'orders',
      partitions: [{ id: 0, replicas: [1, 2], messages: 10 }, { id: 1, replicas: [1, 2], messages: 5 }],
      configs: [
        { name: 'retention.ms', value: '86400000', default: false, sensitive: false },
        { name: 'cleanup.policy', value: 'delete', default: true, sensitive: false },
        { name: 'secret', value: 'x', default: false, sensitive: true },
      ],
    })).toBe('- orders: 2 partitions, replication 2, ~15 messages, retention.ms=86400000')
  })
})
