import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeHttpMock = vi.hoisted(() => vi.fn())

vi.mock('../wailsjs/go/main/App', () => ({
  ExecuteHTTP: executeHttpMock,
}))

import { describeSoapResponseProblem, probeSoapEndpoint, sendSoapRequest, validateSoapXml } from './soapClient'

describe('SOAP client', () => {
  beforeEach(() => {
    executeHttpMock.mockReset()
  })

  it('does not validate an HTML error page as SOAP XML', () => {
    const html = '<!DOCTYPE html><html><body><h1>404</h1></body></html>'

    expect(validateSoapXml(html)).toMatchObject({
      valid: false,
      error: 'Response is HTML, not SOAP XML',
    })
    expect(describeSoapResponseProblem({
      status: 404,
      statusText: 'Not Found',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
      ms: 12,
      size: html.length,
    })).toContain('HTTP 404')
  })

  it('sends SOAP 1.2 action in Content-Type instead of SOAPAction header', async () => {
    executeHttpMock.mockResolvedValue(JSON.stringify({
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/soap+xml' },
      body: '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body /></soap:Envelope>',
      ms: 4,
      size: 96,
    }))

    await sendSoapRequest({
      url: 'https://example.test/service',
      soapAction: 'urn:testAction',
      envelope: '<soap:Envelope />',
      soapVersion: '1.2',
    })

    const payload = JSON.parse(executeHttpMock.mock.calls[0][0])
    expect(payload.headers['Content-Type']).toBe('application/soap+xml; charset=utf-8; action="urn:testAction"')
    expect(payload.headers.SOAPAction).toBeUndefined()
  })

  it('probes WSDL endpoints and reports HTML 404 pages before sending', async () => {
    executeHttpMock.mockResolvedValue(JSON.stringify({
      status: 404,
      statusText: 'Not Found',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<!DOCTYPE html><html><body><h1>404</h1></body></html>',
      ms: 42,
    }))

    const probe = await probeSoapEndpoint('http://www.webservicex.com/globalweather.asmx')

    expect(probe.reachable).toBe(false)
    expect(probe.status).toBe(404)
    expect(probe.problem).toContain('HTTP 404')
    expect(probe.problem).toContain('not a SOAP service response')
  })
})
