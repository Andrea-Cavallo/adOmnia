// Cross-panel handoff: another panel asks the Log Inspector to open a query.
//
// The Log Inspector may not be mounted when the request is made, so the query
// is parked until the panel reads it. Same DOM-event convention already used
// by the mock endpoint store.

const HANDOFF_EVENT = 'adomnia:loginspector-query'

let pendingQuery: string | null = null

/** Ask the Log Inspector to filter on `field:value`; switch the rail separately. */
export function requestLogInspectorQuery(query: string): void {
  pendingQuery = query
  document.dispatchEvent(new CustomEvent(HANDOFF_EVENT, { detail: query }))
}

/** Read and clear a query parked before the panel was mounted. */
export function consumeLogInspectorQuery(): string | null {
  const query = pendingQuery
  pendingQuery = null
  return query
}

export function onLogInspectorQuery(handler: (query: string) => void): () => void {
  const listener = (event: Event) => {
    const query = (event as CustomEvent<string>).detail
    if (typeof query === 'string' && query) {
      pendingQuery = null
      handler(query)
    }
  }
  document.addEventListener(HANDOFF_EVENT, listener)
  return () => document.removeEventListener(HANDOFF_EVENT, listener)
}
