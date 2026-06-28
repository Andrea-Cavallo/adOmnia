import { describe, expect, it } from 'vitest'
import { blankRequest } from '@/lib/types'
import { validatePSD2Request } from '@/lib/psd2Validation'

describe('validatePSD2Request', () => {
  it('accepts non-PSD2 requests', () => {
    expect(validatePSD2Request(blankRequest())).toEqual([])
  })

  it('reports credentials, body and operation headers before send', () => {
    const request = blankRequest('POST')
    request.psd2 = { enabled: true, operation: 'ais-consent', qwacPath: '', qwacPasswordRef: 'plain', qsealPath: '', qsealPasswordRef: '', keyId: '', sign: true }
    const messages = validatePSD2Request(request).map((issue) => issue.message)
    expect(messages).toContain('Select a QWAC certificate for mTLS.')
    expect(messages).toContain('QWAC password must be an encrypted vault: reference.')
    expect(messages).toContain('Select a QSEAL certificate for request signing.')
    expect(messages).toContain('A non-empty body is required when PSD2 signing is enabled.')
    expect(messages).toContain('PSU-IP-Address is required for this operation.')
  })

  it('accepts encrypted password references and a complete signed request', () => {
    const request = blankRequest('POST')
    request.bodies[0] = { ...request.bodies[0], type: 'raw', raw: '{}' }
    request.headers = [{ id: 'psu-ip', key: 'PSU-IP-Address', value: '127.0.0.1', enabled: true }]
    request.psd2 = { enabled: true, operation: 'pis-payment', qwacPath: 'qwac.p12', qwacPasswordRef: 'vault:abc', qsealPath: 'qseal.p12', qsealPasswordRef: 'vault:def', keyId: '', sign: true }
    expect(validatePSD2Request(request)).toEqual([])
  })
})
