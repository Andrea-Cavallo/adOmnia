import { useState, useEffect } from 'react'

let cachedPort: number | null = null

export function useServerPort(): number | null {
  const [port, setPort] = useState<number | null>(cachedPort)

  useEffect(() => {
    if (cachedPort !== null) {
      setPort(cachedPort)
      return
    }
    const app = window.go?.main?.App
    if (!app) return
    app.GetServerPort().then((p) => {
      cachedPort = p
      setPort(p)
    }).catch(() => {})
  }, [])

  return port
}

export function serverUrl(port: number | null, path: string): string {
  if (!port) return ''
  return `http://localhost:${port}${path}`
}
