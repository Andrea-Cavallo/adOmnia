import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeBatchMock = vi.hoisted(() => vi.fn())
const cancelMock = vi.hoisted(() => vi.fn())
const prepareMock = vi.hoisted(() => vi.fn())

vi.mock('../wailsjs/go/main/App', () => ({
  ExecuteHTTPBatch: executeBatchMock,
  CancelHTTP: cancelMock,
}))

vi.mock('./sendRequest', () => ({
  prepareExecution: prepareMock,
  responseFromGo: (response: Record<string, unknown>, fullUrl: string) => ({
    status: response.status,
    statusText: response.statusText,
    headers: {},
    body: response.body ?? '',
    contentType: '',
    ms: response.ms ?? 0,
    size: response.size ?? 0,
    fullUrl,
  }),
}))

import { sendRequestInParallel } from './parallelSend'
import type { RequestItem } from './types'

const request = { id: 'r1', name: 'Login', method: 'POST', url: 'https://api.test/login' } as RequestItem
const baseExec = { id: 'exec-1', method: 'POST', url: 'https://api.test/login', headers: {}, body: '{"user":"a"}', timeoutMs: 30000 }

function batchOf(count: number) {
  return {
    concurrency: Math.min(4, count),
    ms: 42,
    results: Array.from({ length: count }, (_, index) => ({
      index,
      response: { status: 200, statusText: 'OK', headers: {}, body: `body-${index}`, contentType: 'application/json', ms: 10, size: 6 },
    })),
  }
}

describe('parallel send', () => {
  beforeEach(() => {
    executeBatchMock.mockReset()
    cancelMock.mockReset()
    prepareMock.mockReset()
    prepareMock.mockResolvedValue({ kind: 'go', exec: baseExec, reqId: 'exec-1', fullUrl: 'https://api.test/login' })
  })

  it('repeats the resolved request without re-preparing it', async () => {
    executeBatchMock.mockResolvedValue(JSON.stringify(batchOf(5)))

    const outcome = await sendRequestInParallel(request, { base: 'https://api.test' })

    expect(prepareMock).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(executeBatchMock.mock.calls[0][0] as string)
    expect(payload.request).toMatchObject({ id: 'exec-1', body: '{"user":"a"}' })
    expect(payload.bodies).toEqual(Array(5).fill('{"user":"a"}'))
    expect(payload.concurrency).toBe(4)
    expect(outcome.results.map((item) => item.response.body)).toEqual(['body-0', 'body-1', 'body-2', 'body-3', 'body-4'])
  })

  it('sends one body per copy when variants are given', async () => {
    executeBatchMock.mockResolvedValue(JSON.stringify(batchOf(2)))

    const outcome = await sendRequestInParallel(request, {}, { bodies: ['{"n":1}', '{"n":2}'], copies: 10 })

    const payload = JSON.parse(executeBatchMock.mock.calls[0][0] as string)
    expect(payload.bodies).toEqual(['{"n":1}', '{"n":2}'])
    expect(payload.concurrency).toBe(2)
    expect(outcome.results).toHaveLength(2)
  })

  it('cancels every variant by the ids the Go batch assigns', async () => {
    let finishBatch: (value: string) => void = () => {}
    executeBatchMock.mockImplementation(() => new Promise<string>((resolve) => { finishBatch = resolve }))
    const controller = new AbortController()

    const pending = sendRequestInParallel(request, {}, { copies: 3, signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    finishBatch(JSON.stringify(batchOf(3)))
    await pending

    expect(cancelMock.mock.calls.map((call) => call[0])).toEqual(['exec-1-1', 'exec-1-2', 'exec-1-3'])
  })

  it('reports a batch-level failure and a transport the batch cannot use', async () => {
    executeBatchMock.mockResolvedValue(JSON.stringify({ error: { code: 'BATCH_ERR', message: 'too many requests' } }))
    const rejected = await sendRequestInParallel(request, {}, { copies: 2 })
    expect(rejected.error).toBe('too many requests')
    expect(rejected.results).toHaveLength(0)

    prepareMock.mockResolvedValue({ kind: 'browser', body: new FormData() })
    const browser = await sendRequestInParallel(request, {})
    expect(browser.error).toContain('cannot run in parallel')
    expect(executeBatchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a preparation error without calling the batch', async () => {
    prepareMock.mockResolvedValue({ kind: 'error', response: { status: 0, error: { code: 'VAULT_ERR', message: 'vault locked' } } })

    const outcome = await sendRequestInParallel(request, {})

    expect(outcome.error).toBe('vault locked')
    expect(executeBatchMock).not.toHaveBeenCalled()
  })
})
