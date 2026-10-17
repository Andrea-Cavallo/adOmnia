import type { GoIDEProfileReport } from '@/lib/code-studio-api'
export interface RuntimeProfileCost { file: string; line: number; metric: string; unit: string; value: number; profile: string; at: string; function?: string }
const METRICS = new Set(['cpu','alloc_space','alloc_objects'])
/** Keep sampled CPU and allocation totals. They are not request durations or
 * exact per-call allocations: the artifact and sample type remain attached. */
export function runtimeProfileCosts(report: GoIDEProfileReport): RuntimeProfileCost[] {
  const result: RuntimeProfileCost[] = []
  report.sampleTypes.forEach((type,index)=>{
    if(!METRICS.has(type.name))return
    for(const row of report.lines ?? []) {
      const value=row.value[index] ?? 0
      if(row.relative && row.line>0 && value>0)result.push({file:row.relative,line:row.line,metric:type.name,unit:type.unit,value,profile:report.name,at:report.time})
    }
    for(const node of report.topFlat ?? []) {
      const value=node.flat[index] ?? 0
      if(node.function.relative && node.function.line && value>0)result.push({file:node.function.relative,line:node.function.line,metric:type.name,unit:type.unit,value,profile:report.name,at:report.time,function:node.function.name})
    }
  })
  return result
}
