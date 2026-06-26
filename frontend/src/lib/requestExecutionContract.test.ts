import { describe, expect, it } from 'vitest'
import { toHTTPExecPayload, type ResolvedRequest } from '@/lib/requestExecutionContract'

describe('request execution contract', () => {
  it('maps the resolved request to the Go HTTP transport payload without UI-only plans', () => {
    const resolved: ResolvedRequest = {
      id: 'exec-1',
      sourceRequestId: 'req-1',
      method: 'POST',
      url: 'https://api.example.test/v1/users',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{"name":"Ada"}',
      timeoutMs: 15000,
      followRedirects: true,
      maxRedirects: 5,
      stripAuthOnRedirect: true,
      skipTlsVerify: false,
      clientCertPem: '',
      clientCertPassphrase: '',
      hostsMap: [{ host: 'api.example.test', ip: '127.0.0.1', enabled: true }],
      assertionPlan: [
        {
          id: 'assert-status',
          enabled: true,
          target: 'statusCode',
          operator: 'eq',
          expected: '201',
        },
      ],
      scriptPlan: { tests: 'pm.test("ok", () => {})' },
      sourceMetadata: { requestId: 'req-1', requestName: 'Create user' },
    }

    expect(toHTTPExecPayload(resolved)).toEqual({
      id: 'exec-1',
      method: 'POST',
      url: 'https://api.example.test/v1/users',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{"name":"Ada"}',
      timeoutMs: 15000,
      followRedirects: true,
      maxRedirects: 5,
      stripAuthOnRedirect: true,
      skipTlsVerify: false,
      clientCertPem: '',
      clientCertPassphrase: '',
      hostsMap: [{ host: 'api.example.test', ip: '127.0.0.1', enabled: true }],
    })
  })
})

