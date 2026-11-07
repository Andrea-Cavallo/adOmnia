import type { DbConnection } from './dbShared'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function sameHost(a: string, b: string): boolean {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  return left === right || (LOOPBACK.has(left) && LOOPBACK.has(right))
}

/**
 * The saved connection that reaches the database a live query went to. The SQL capture proxy
 * names it `kind://host:port` (postgres/mysql); an unparsable or unknown datasource matches
 * nothing, so the developer picks the connection instead of running on a guessed one.
 */
export function connectionForDatasource(connections: readonly DbConnection[], datasource: string | undefined): DbConnection | undefined {
  const match = /^(postgres|postgresql|mysql):\/\/(.+):(\d+)$/i.exec(datasource?.trim() ?? '')
  if (!match) return undefined
  const driver = match[1].toLowerCase().startsWith('postgres') ? 'postgres' : 'mysql'
  const host = match[2].replace(/^\[(.*)\]$/, '$1')
  const port = Number(match[3])
  const candidates = connections.filter((connection) => connection.driver === driver && connection.port === port && sameHost(connection.host, host))
  // Two saved connections to the same server (different databases) are a real choice: no guess.
  return candidates.length === 1 ? candidates[0] : undefined
}
