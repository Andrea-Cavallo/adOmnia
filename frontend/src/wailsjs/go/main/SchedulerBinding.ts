export interface ScheduledJob {
  id: string
  name: string
  cronExpr: string
  requestId: string
  collectionId?: string
  enabled: boolean
  createdAt: string
  lastRunAt?: string
  nextRunAt?: string
}

export interface JobRun {
  jobId: string
  startedAt: string
  durationMs: number
  statusCode: number
  error?: string
  success: boolean
}

export function AddJob(name: string, cronExpr: string, requestID: string): Promise<ScheduledJob> {
  return window['go']['main']['SchedulerBinding']['AddJob'](name, cronExpr, requestID)
}

export function UpdateJob(id: string, name: string, cronExpr: string, requestID: string): Promise<ScheduledJob> {
  return window['go']['main']['SchedulerBinding']['UpdateJob'](id, name, cronExpr, requestID)
}

export function DeleteJob(id: string): Promise<void> {
  return window['go']['main']['SchedulerBinding']['DeleteJob'](id)
}

export function EnableJob(id: string): Promise<void> {
  return window['go']['main']['SchedulerBinding']['EnableJob'](id)
}

export function DisableJob(id: string): Promise<void> {
  return window['go']['main']['SchedulerBinding']['DisableJob'](id)
}

export function ListJobs(): Promise<ScheduledJob[]> {
  return window['go']['main']['SchedulerBinding']['ListJobs']()
}

export function GetHistory(jobID: string): Promise<JobRun[]> {
  return window['go']['main']['SchedulerBinding']['GetHistory'](jobID)
}
