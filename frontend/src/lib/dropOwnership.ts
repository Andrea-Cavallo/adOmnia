/** Whether the app-level drop handler should process an event after child panels. */
export function shouldHandleGlobalDrop(_defaultPrevented: boolean): boolean {
  return !_defaultPrevented
}
