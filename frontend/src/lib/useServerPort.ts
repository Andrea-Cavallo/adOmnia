import { useState, useEffect } from 'react'
import { GetServerPort, GetSidecarToken } from '../wailsjs/go/main/App'

let cachedPort: number | null = null
let cachedToken: string | null = null
let tokenFlight: Promise<string> | null = null

export function useServerPort(): number | null {
  const [port, setPort] = useState<number | null>(cachedPort)

  useEffect(() => {
    if (cachedPort !== null) {
      setPort(cachedPort)
      return
    }
    try {
      GetServerPort().then((p) => {
        cachedPort = p
        setPort(p)
      }).catch(() => {})
    } catch {
      // The frontend preview can render without a Wails bridge.
    }
  }, [])

  return port
}

export function serverUrl(port: number | null, path: string): string {
  if (!port) return ''
  return `http://localhost:${port}${path}`
}

function resolveSidecarToken(): Promise<string> {
  if (cachedToken !== null) return Promise.resolve(cachedToken)
  if (tokenFlight) return tokenFlight
  tokenFlight = GetSidecarToken()
    .then((t) => {
      cachedToken = t
      tokenFlight = null
      return t
    })
    .catch(() => {
      tokenFlight = null
      return ''
    })
  return tokenFlight
}

export function getSidecarToken(): Promise<string> {
  return resolveSidecarToken()
}

/**
 * Drop-in replacement for fetch() when calling the local sidecar.
 * Automatically injects the session token that guards sidecar endpoints.
 */
export async function sidecarFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await resolveSidecarToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set('X-Sidecar-Token', token)
  return fetch(url, { ...init, headers })
}
