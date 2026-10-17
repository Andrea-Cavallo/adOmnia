import { create } from 'zustand'
import type { GoIDEProfileReport } from '@/lib/code-studio-api'
import { runtimeProfileCosts, type RuntimeProfileCost } from '@/lib/code-studio/runtimeProfileCost'
import { packageRuntime, type PackageRuntime } from '@/lib/code-studio/dependencyHeatmap'
export const useCodeStudioRuntimeProfile = create<{ costs: Record<string,RuntimeProfileCost[]>; packages: Record<string,PackageRuntime>; publish:(session:string,report:GoIDEProfileReport)=>void }>((set)=>({
 costs:{},
 packages:{},
 publish:(session,report)=>set(state=>{
  const metrics=new Set(report.sampleTypes.map(type=>type.name))
  const costs=[...(state.costs[session] ?? []).filter(cost=>!metrics.has(cost.metric)),...runtimeProfileCosts(report)]
  return {costs:{...state.costs,[session]:costs},packages:{...state.packages,[session]:packageRuntime(report)}}
 }),
}))
