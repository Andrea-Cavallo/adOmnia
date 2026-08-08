import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PluginNotification {
  pluginId: string
  title: string
  message: string
  type: 'info' | 'warning' | 'error' | 'success'
}

const notificationTheme = {
  info: { icon: Info, color: 'text-accent', border: 'border-accent/25' },
  warning: { icon: AlertTriangle, color: 'text-warning', border: 'border-warning/25' },
  error: { icon: XCircle, color: 'text-error', border: 'border-error/25' },
  success: { icon: CheckCircle2, color: 'text-success', border: 'border-success/25' },
}

export function PluginNotificationToast() {
  const [notification, setNotification] = useState<PluginNotification | null>(null)
  const dismissTimer = useRef<number | null>(null)

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    void import('@/wailsjs/runtime/runtime').then(({ EventsOn }) => {
      unsubscribe = EventsOn('plugin:notification', (value) => {
        const next = value as PluginNotification
        setNotification(next)
        if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current)
        dismissTimer.current = window.setTimeout(() => setNotification(null), 5000)
      })
    })
    return () => {
      unsubscribe?.()
      if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current)
    }
  }, [])

  if (!notification) return null
  const theme = notificationTheme[notification.type] ?? notificationTheme.info
  const Icon = theme.icon

  return (
    <div className={cn(
      'absolute right-4 top-12 z-[9999] flex max-w-[420px] items-start gap-2 rounded-lg border bg-surface-1/95 px-3 py-2 text-xs shadow-2xl shadow-black/40 backdrop-blur-md toast-enter',
      theme.border,
    )}>
      <Icon size={14} className={cn('mt-0.5 shrink-0', theme.color)} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text-1">{notification.title || notification.pluginId}</p>
        <p className="mt-0.5 text-text-2">{notification.message}</p>
      </div>
      <button
        type="button"
        onClick={() => setNotification(null)}
        className="text-text-4 hover:text-text-1"
        aria-label="Dismiss plugin notification"
      >
        <XCircle size={13} />
      </button>
    </div>
  )
}
