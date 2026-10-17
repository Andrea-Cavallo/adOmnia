/** Native close preserves detached-window and running-task guards. */
export async function restartForUpdate(): Promise<void> {
  const { useCodeStudioStore } = await import('@/stores/codeStudio')
  for (const doc of useCodeStudioStore.getState().documents.filter(doc => doc.dirty)) {
    if (!await useCodeStudioStore.getState().saveDocument(doc.document.id)) throw new Error('Could not save an open file. Save your work and try again.')
  }
  const { flushPendingSaves } = await import('./storeSave')
  await flushPendingSaves(true)
  const { ScheduleUpdateOnExit } = await import('../../bindings/adomnia/app')
  const status = await ScheduleUpdateOnExit(true)
  if (!status.scheduled) throw new Error('The update could not be scheduled.')
  const { useUpdaterStore } = await import('@/stores/updater')
  useUpdaterStore.setState({ status, error: '' })
  const { Window } = await import('@wailsio/runtime')
  try { await Window.Close() }
  catch (error) { useUpdaterStore.setState({ status: await ScheduleUpdateOnExit(false) }); throw error }
}
