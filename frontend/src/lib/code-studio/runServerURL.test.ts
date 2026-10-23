import { describe, expect, it } from 'vitest'
import { firstLocalServerURL, localServerURLs } from './runServerURL'

describe('local server URLs in run output', () => {
  it('finds what uvicorn, Django, Flask and Vite print', () => {
    expect(localServerURLs('Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)')).toEqual(['http://127.0.0.1:8000'])
    expect(localServerURLs('Starting development server at http://127.0.0.1:8000/\n')).toEqual(['http://127.0.0.1:8000/'])
    expect(localServerURLs(' * Running on http://127.0.0.1:5000')).toEqual(['http://127.0.0.1:5000'])
    expect(localServerURLs('  Local:   http://localhost:5173/')).toEqual(['http://localhost:5173/'])
  })

  it('turns wildcard and IPv6 loopback hosts into localhost and keeps https', () => {
    expect(localServerURLs('listening on http://0.0.0.0:8080/api')).toEqual(['http://localhost:8080/api'])
    expect(localServerURLs('ready https://[::1]:8443/')).toEqual(['https://localhost:8443/'])
  })

  it('ignores remote hosts and keeps only the first URL', () => {
    expect(localServerURLs('see https://example.com:8443/x and http://10.0.0.5:8080')).toEqual([])
    expect(firstLocalServerURL('http://127.0.0.1:9000\nhttp://127.0.0.1:9001')).toBe('http://127.0.0.1:9000')
    expect(firstLocalServerURL('nothing here')).toBeNull()
  })

  it('drops duplicates and trailing punctuation', () => {
    expect(localServerURLs('http://127.0.0.1:8000 then again http://127.0.0.1:8000, done.')).toEqual(['http://127.0.0.1:8000'])
  })

  it('finds the address of axum, actix and Rocket even without the scheme (RS-3.5)', () => {
    expect(localServerURLs('listening on 0.0.0.0:3000')).toEqual(['http://localhost:3000'])
    expect(localServerURLs('[INFO  actix_server::builder] Starting 4 workers\n[INFO  actix_server::builder] Starting "actix-web-service-0.0.0.0:8080" service on: 0.0.0.0:8080')).toEqual(['http://localhost:8080'])
    expect(localServerURLs('🚀 Rocket has launched from http://localhost:8000')).toEqual(['http://localhost:8000'])
    expect(firstLocalServerURL('Starting 4 workers\nlistening at 127.0.0.1:3030')).toBe('http://127.0.0.1:3030')
  })

  it('does not invent a server from addresses that are not a listen (RS-3.5)', () => {
    expect(localServerURLs('connected to postgres at localhost:5432')).toEqual([])
    expect(localServerURLs('redis client 127.0.0.1:6379 reconnected')).toEqual([])
    expect(localServerURLs('listening on http://0.0.0.0:8080/api and 0.0.0.0:8080')).toEqual(['http://localhost:8080/api'])
  })
})
