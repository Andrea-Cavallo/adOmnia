/**
 * emptyRunMessage dice perché l'albero dei test è vuoto: run in corso, run interrotto, comando
 * fallito prima dei risultati, oppure nessun test corrisponde ai filtri (PY-5.4). Senza questa
 * distinzione un run interrotto sembrava "nessun test corrisponde ai filtri".
 */
export function emptyRunMessage(run: { status: string; diagnostics?: string }): string {
  if (run.status === 'running') return 'Building and starting tests…'
  if (run.status === 'stopped') return 'The test run was stopped before it produced results.'
  if (run.diagnostics) return 'The test command failed before producing results. See the Output tab.'
  return 'No test matches the filters.'
}
