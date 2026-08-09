// Open a URL in the user's real browser (Wails), falling back to window.open.
export function openExternal(url: string): void {
  import('@/wailsjs/runtime/runtime')
    .then(({ BrowserOpenURL }) => BrowserOpenURL(url))
    .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
}
