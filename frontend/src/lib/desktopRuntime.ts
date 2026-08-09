/**
 * Is the UI running inside the Wails desktop shell?
 *
 * Under Wails 2 this was answered by probing `window.go.main.<Service>`, since
 * the bridge injected one global per bound service. Wails 3 has no such global:
 * bindings are imported modules that always exist at build time, so probing
 * them answers "did this bundle compile", not "is there a backend".
 *
 * The runtime still injects `window._wails`, and that is the honest signal.
 */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { _wails?: unknown })._wails)
}
