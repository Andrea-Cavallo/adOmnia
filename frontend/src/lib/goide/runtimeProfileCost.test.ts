import { expect,it } from 'vitest'
import type { GoIDEProfileReport } from '@/lib/goide-api'
import { runtimeProfileCosts } from './runtimeProfileCost'
it('keeps CPU and allocation samples tied to real source, units and artifact',()=>{
 const report={name:'memory.pprof',time:'2026-10-10',sampleTypes:[{name:'alloc_space',unit:'bytes'},{name:'inuse_space',unit:'bytes'}],lines:[{relative:'worker.go',line:12,value:[8192,4096]},{relative:'',line:8,value:[100,100]}],topFlat:[{function:{relative:'worker.go',line:4,name:'main.Work'},flat:[16384,4096]}]} as unknown as GoIDEProfileReport
 const costs=runtimeProfileCosts(report)
 expect(costs).toHaveLength(2)
 expect(costs[0]).toMatchObject({file:'worker.go',line:12,metric:'alloc_space',unit:'bytes',value:8192,profile:'memory.pprof'})
 expect(costs[1]).toMatchObject({line:4,function:'main.Work',value:16384})
})
