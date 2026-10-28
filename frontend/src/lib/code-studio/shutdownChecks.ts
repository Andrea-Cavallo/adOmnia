import type { ShutdownReport } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'

export interface ShutdownCheck { label: string; status: 'ok' | 'warn' | 'bad' | 'unknown'; detail: string }

const DB = /PostgreSQL|MySQL|SQL Server|Oracle|Redis|MongoDB|Cassandra/
const BROKER = /Kafka|NATS|RabbitMQ/
const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`)

/** What the observed shutdown says about each graceful-shutdown concern. */
export function shutdownChecks(report: ShutdownReport): ShutdownCheck[] {
  const shutdown = report.shutdown
  const after = (atMs: number) => `+${ms(atMs - shutdown.signalAtMs)}`
  const events = report.events ?? []
  const output = events.filter((event) => event.kind === 'output').map((event) => event.detail)
  const stillOpen = shutdown.stillOpen ?? []
  const unlisten = events.find((event) => event.kind === 'unlisten')
  const disconnects = events.filter((event) => event.kind === 'disconnect')
  const dump = shutdown.goroutineDump ?? ''
  const goroutines = Number(/goroutine profile: total (\d+)/.exec(dump)?.[1] ?? 0)
  const checks: ShutdownCheck[] = []
  const cancelled = output.find((line) => /context canceled|context cancelled|ctx\.Done|shutting down|graceful/i.test(line))
  checks.push(cancelled ? { label: 'Context cancellation', status: 'ok', detail: cancelled } : { label: 'Context cancellation', status: shutdown.exited ? 'unknown' : 'warn', detail: 'No log line mentions the cancellation or the shutdown.' })
  checks.push(unlisten
    ? { label: 'HTTP graceful shutdown', status: 'ok', detail: `stopped accepting connections ${after(unlisten.atMs)} after the signal` }
    : { label: 'HTTP graceful shutdown', status: shutdown.exited ? 'unknown' : 'bad', detail: shutdown.exited ? 'The process exited; the listener closed with it.' : 'The server kept listening after the signal.' })
  const dbClosed = disconnects.filter((event) => DB.test(event.detail))
  const dbOpen = stillOpen.filter((item) => DB.test(item))
  checks.push(dbOpen.length ? { label: 'DB cleanup', status: 'bad', detail: `still open: ${dbOpen.join(', ')}` } : dbClosed.length ? { label: 'DB cleanup', status: 'ok', detail: dbClosed.map((event) => `${event.detail} closed ${after(event.atMs)}`).join(', ') } : { label: 'DB cleanup', status: 'unknown', detail: 'No database connection was seen.' })
  const brokerOpen = stillOpen.filter((item) => BROKER.test(item))
  const brokerClosed = disconnects.filter((event) => BROKER.test(event.detail))
  checks.push(brokerOpen.length ? { label: 'Pending broker messages', status: 'bad', detail: `connection still open: ${brokerOpen.join(', ')} — messages may not be flushed` } : brokerClosed.length ? { label: 'Pending broker messages', status: 'ok', detail: brokerClosed.map((event) => `${event.detail} closed ${after(event.atMs)}`).join(', ') } : { label: 'Pending broker messages', status: 'unknown', detail: 'No broker connection was seen.' })
  checks.push(shutdown.timedOut ? { label: 'Timeout', status: 'bad', detail: 'The process did not exit within the grace period and was killed.' } : shutdown.exitCode === 3221225786
      ? { label: 'Timeout', status: 'warn', detail: `killed by the interrupt ${after(shutdown.exitAtMs)} after the signal: no handler (signal.NotifyContext) ran a graceful shutdown` }
      : { label: 'Timeout', status: 'ok', detail: `exited ${after(shutdown.exitAtMs)} after the signal (exit code ${shutdown.exitCode})` })
  checks.push(stillOpen.length ? { label: 'Resource leaks', status: 'bad', detail: `connections still open at the timeout: ${stillOpen.join(', ')}` } : { label: 'Resource leaks', status: 'ok', detail: 'No connection left open.' })
  checks.push(shutdown.timedOut
    ? { label: 'Pending goroutines', status: dump ? 'bad' : 'warn', detail: dump ? `${goroutines} goroutines were still running: see the dump below` : 'Import net/http/pprof to see which goroutines keep the process alive.' }
    : { label: 'Pending goroutines', status: 'ok', detail: 'None kept the process alive.' })
  return checks
}
