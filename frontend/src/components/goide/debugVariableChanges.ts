/** Only loaded values participate: fetching another scope must not erase previous changes. */
export function changedDebugValues(previous: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): Set<string> {
  return new Set([...next].filter(([key, value]) => previous.has(key) && previous.get(key) !== value).map(([key]) => key))
}
