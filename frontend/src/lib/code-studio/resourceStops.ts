/** Stop every owned service even when another one fails; never report partial success as success. */
export async function settleResourceStops(jobs: { label: string; stop: () => Promise<unknown> }[]): Promise<string[]> {
  const results = await Promise.allSettled(jobs.map(async job => { await job.stop() }))
  return results.flatMap((result, index) => result.status === 'rejected' ? [`${jobs[index].label}: ${String(result.reason)}`] : [])
}

