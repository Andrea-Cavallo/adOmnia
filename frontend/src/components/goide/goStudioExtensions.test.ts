import { beforeEach,describe,expect,it,vi } from 'vitest'
const fixture = vi.hoisted(() => ({
 invoke:vi.fn(), markers:vi.fn(), lsp:{pendingChange:null as unknown,message:null as unknown},
 state:{activeSessionId:'s',activeDocumentBySession:{s:'d'},documents:[{document:{id:'d',sessionId:'s',path:'/project/main.go',relativePath:'main.go',language:'go'},buffer:'unsaved',content:'saved'}]},
}))
vi.mock('@/stores/goide',()=>({useGoIDEStore:{getState:()=>fixture.state,subscribe:vi.fn()}}))
vi.mock('@/stores/goideLsp',()=>({useGoIDELspStore:{getState:()=>fixture.lsp,setState:(next:object)=>Object.assign(fixture.lsp,next)}}))
vi.mock('@/stores/plugins',()=>({usePluginsStore:{subscribe:vi.fn()}}))
vi.mock('@/lib/goide-api',()=>({subscribeGoIDEEvents:vi.fn()}))
vi.mock('../../../bindings/adomnia/goide',()=>({InvokeIDEExtension:fixture.invoke,IDEContributions:vi.fn(async()=>[])}))
vi.mock('@/lib/monacoSetup',()=>({monaco:{editor:{setModelMarkers:fixture.markers,getModel:vi.fn(()=>({}))},Uri:{parse:(value:string)=>value},MarkerSeverity:{Error:8,Warning:4,Info:2,Hint:1}}}))
vi.mock('./goStudioLanguageFeatures',()=>({documentForModel:vi.fn(),registerGoStudioLanguageFeatures:vi.fn()}))
vi.mock('./goStudioModelUri',()=>({editorModelUri:()=> 'file:///project/main.go'}))
vi.mock('./goStudioEditorRegistry',()=>({activeGoStudioEditor:()=>null}))
import { runIDEContribution } from './goStudioExtensions'
import { useIDEExtensionsStore,type IDEContribution } from '@/stores/ideExtensions'
const item = {pluginId:'plugin',pluginName:'Plugin',kind:'codeAction',id:'fix',title:'Fix',action:'fix'} as IDEContribution

beforeEach(()=>{
 vi.clearAllMocks(); fixture.state.activeSessionId='s'; fixture.state.activeDocumentBySession.s='d'; fixture.state.documents[0].buffer='unsaved'; fixture.lsp.pendingChange=null
 useIDEExtensionsStore.setState({items:[item],reports:{}})
 fixture.invoke.mockResolvedValue({success:true,data:{text:'corrected',diagnostics:[{line:1,message:'real diagnostic',severity:1}]}})
})
describe('IDE contribution integration',()=>{
 it('sends the live buffer and prepares reviewable changes without applying them',async()=>{
  await runIDEContribution(item)
  expect(fixture.invoke).toHaveBeenCalledWith(expect.objectContaining({sessionId:'s',documentId:'d',text:'unsaved',kind:'codeAction'}))
  expect(fixture.lsp.pendingChange).toMatchObject({label:'Fix',files:[{originalContent:'unsaved',newContent:'corrected',relativePath:'main.go'}]})
  expect(fixture.state.documents[0].buffer).toBe('unsaved')
  expect(Object.values(useIDEExtensionsStore.getState().reports.s)[0].diagnostics[0].message).toBe('real diagnostic')
 })
 it.each(['buffer','project','disable','tab'])('discards stale results after %s changes',async(change)=>{
  let resolve!:(value:unknown)=>void
  fixture.invoke.mockReturnValue(new Promise(done=>{resolve=done}))
  const running=runIDEContribution(item)
  if(change==='buffer') fixture.state.documents[0].buffer='new edit'
  if(change==='project') fixture.state.activeSessionId='other'
  if(change==='tab') fixture.state.activeDocumentBySession.s='other'
  if(change==='disable') useIDEExtensionsStore.setState({items:[]})
  resolve({success:true,data:{text:'corrected',diagnostics:[{line:1,message:'obsolete'}]}})
  await running
  expect(fixture.lsp.pendingChange).toBeNull()
  expect(useIDEExtensionsStore.getState().reports).toEqual({})
 })
 it('analyzers publish diagnostics but cannot stage unsolicited source replacements',async()=>{
  await runIDEContribution(item,'d',true)
  expect(fixture.lsp.pendingChange).toBeNull()
  expect(useIDEExtensionsStore.getState().reports.s).toBeDefined()
 })
 it('preserves a pending review instead of replacing it with a new result',async()=>{
  fixture.lsp.pendingChange={label:'Previous review'}
  await runIDEContribution(item)
  expect(fixture.lsp.pendingChange).toEqual({label:'Previous review'})
  expect(fixture.lsp.message).toContain('Review or discard')
 })
})
