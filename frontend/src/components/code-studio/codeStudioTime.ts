/** Tempo relativo breve, come nei pannelli di GoLand ("3 min ago"). */
export function relativeTime(savedAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(savedAt).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86_400)} d ago`
}
