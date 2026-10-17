/** Session grace periods do not move when unrelated windows/documents change. */
export function createHibernationController(onSleep: (id: string) => void, onWake: (id: string) => void, delay: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const sleeping = new Set<string>()
  return {
    reconcile(ids: readonly string[], awake: ReadonlySet<string>) {
      const alive = new Set(ids)
      for (const id of timers.keys()) if (!alive.has(id) || awake.has(id)) {
        clearTimeout(timers.get(id)); timers.delete(id)
      }
      for (const id of sleeping) if (!alive.has(id) || awake.has(id)) {
        sleeping.delete(id); onWake(id)
      }
      for (const id of alive) if (!awake.has(id) && !timers.has(id) && !sleeping.has(id)) {
        timers.set(id, setTimeout(() => {
          timers.delete(id); sleeping.add(id); onSleep(id)
        }, delay))
      }
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear(); sleeping.clear()
    },
  }
}
