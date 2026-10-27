import { ReportActivity, RemoveActivity } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/app'
import type { ActivityPhase } from '@/stores/activity'
import type { State } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/activity/models'

export async function reportActivity(phase: ActivityPhase, scopes: readonly string[]): Promise<void> {
  await ReportActivity(phase as State, [...scopes])
}
export async function removeActivity(): Promise<void> { await RemoveActivity() }
