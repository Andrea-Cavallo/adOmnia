import { create } from 'zustand'
import type { GoIDEProfileReport } from '@/lib/goide-api'
import { runtimeProfileCosts, type RuntimeProfileCost } from '@/lib/goide/runtimeProfileCost'
export const useGoStudioRuntimeProfile = create<{ costs: Record<string,RuntimeProfileCost[]>; publish:(session:string,report:GoIDEProfileReport)=>void }>((set)=>({
 costs:{},
 publish:(session,report)=>set(state=>{
  const metrics=new Set(report.sampleTypes.map(type=>type.name))
  const costs=[...(state.costs[session] ?? []).filter(cost=>!metrics.has(cost.metric)),...runtimeProfileCosts(report)]
  return {costs:{...state.costs,[session]:costs}}
 }),
}))
