import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { useDevLogsStore } from './stores/devLogs'
import type { LogLevel } from './stores/devLogs'
import { recordFrontendDevLog } from './lib/devlogs-api'

// Save references to native console methods before we overwrite them
const nativeLog = console.log.bind(console) as (...args: unknown[]) => void
const nativeWarn = console.warn.bind(console) as (...args: unknown[]) => void
const nativeError = console.error.bind(console) as (...args: unknown[]) => void
const nativeInfo = console.info.bind(console) as (...args: unknown[]) => void
const nativeDebug = console.debug.bind(console) as (...args: unknown[]) => void

// Expose raw native console for debugging the interceptor itself
;(window as any).__nativeConsole = { log: nativeLog, warn: nativeWarn, error: nativeError, info: nativeInfo, debug: nativeDebug }

function installDevLogInterceptor() {
  const formatArgs = (args: unknown[]): string =>
    args
      .map((arg) => {
        if (arg instanceof Error) return arg.stack || arg.message
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2)
          } catch {
            return String(arg)
          }
        }
        return String(arg)
      })
      .join(' ')

  const addEntry = (level: LogLevel, msg: string) => {
    try {
      useDevLogsStore.getState().addEntry(level, msg)
      if (level === 'warn' || level === 'error') {
        void recordFrontendDevLog(level, msg).catch(() => undefined)
      }
    } catch (e) {
      nativeError('[devLog interceptor error]', e)
    }
  }

  console.log = (...args: unknown[]) => {
    nativeLog(...args)
    addEntry('log', formatArgs(args))
  }
  console.warn = (...args: unknown[]) => {
    nativeWarn(...args)
    addEntry('warn', formatArgs(args))
  }
  console.error = (...args: unknown[]) => {
    nativeError(...args)
    addEntry('error', formatArgs(args))
  }
  console.info = (...args: unknown[]) => {
    nativeInfo(...args)
    addEntry('info', formatArgs(args))
  }
  console.debug = (...args: unknown[]) => {
    nativeDebug(...args)
    addEntry('debug', formatArgs(args))
  }
}

installDevLogInterceptor()

window.addEventListener('error', (event) => {
  console.error('[window.error]', event.message, event.filename, event.lineno, event.colno, event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason)
})

console.info(`--- SESSION START ${new Date().toISOString()} ---`)
// Seed a few test entries so the user can see that logging works
console.info('DevLog interceptor active — press Ctrl+Shift+D or click LOG icon to view')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
