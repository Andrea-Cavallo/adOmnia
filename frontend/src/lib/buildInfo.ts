/**
 * Build-time constants injected by Vite via `define`.
 * Available both in dev (wails dev) and production builds.
 */

/** App version read from build/config.yml info.version */
export const APP_VERSION: string = __APP_VERSION__

/** ISO-8601 UTC timestamp of when the build was started */
export const BUILD_DATE: string = __BUILD_DATE__

/** Short git commit hash (first 7 chars) */
export const COMMIT_HASH: string = __COMMIT_HASH__

/**
 * Human-readable build date, e.g. "24 May 2026"
 * Falls back to the raw ISO string if formatting fails.
 */
export function formatBuildDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
