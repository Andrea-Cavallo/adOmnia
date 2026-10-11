import { create } from 'zustand'
import type { GoIDEProfileReport } from '@/lib/goide-api'
import { runtimeProfileCosts, type RuntimeProfileCost } from '@/lib/goide/runtimeProfileCost'
import { packageRuntime, type PackageRuntime } from '@/lib/goide/dependencyHeatmap'
export const useGoStudioRuntimeProfile = create<{ costs: Record<string,RuntimeProfileCost[]>; packages: Record<string,PackageRuntime>; publish:(session:string,report:GoIDEProfileReport)=>void }>((set)=>({
 costs:{},
 packages:{},
 publish:(session,report)=>set(state=>{
  const metrics=new Set(report.sampleTypes.map(type=>type.name))
  const costs=[...(state.costs[session] ?? []).filter(cost=>!metrics.has(cost.metric)),...runtimeProfileCosts(report)]
  return {costs:{...state.costs,[session]:costs},packages:{...state.packages,[session]:packageRuntime(report)}}
 }),
}))
