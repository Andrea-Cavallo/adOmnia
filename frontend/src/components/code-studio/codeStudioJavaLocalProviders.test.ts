import { beforeEach, expect, it, vi } from 'vitest'
import type { monaco } from '@/lib/monacoSetup'
const mock=vi.hoisted(()=>({ ready:false, providers:new Map<string,unknown>(), request:vi.fn(), flush:vi.fn(), documents:[] as unknown[] }))
vi.mock('@/lib/monacoSetup',()=>({monaco:{
 MarkerSeverity:{Error:8,Warning:4,Info:2,Hint:1},
 Uri:{parse:(uri:string)=>({toString:()=>uri,with:({fragment}:{fragment:string})=>({toString:()=>uri.split('#')[0]+(fragment?'#'+fragment:'')})})},
 languages:{
  CompletionItemKind:{Class:7,Method:0,Field:4,Constant:14,Variable:5,Keyword:17,Snippet:27},CompletionItemInsertTextRule:{InsertAsSnippet:4},
  ...Object.fromEntries(['CompletionItem','Hover','SignatureHelp','Definition','TypeDefinition','DocumentSymbol','DocumentFormattingEdit','CodeAction'].map(name=>['register'+name+'Provider',(_languages:unknown,provider:unknown)=>mock.providers.set(name,provider)])),
 },
 editor:{registerCommand:vi.fn(),registerEditorOpener:vi.fn(),getModels:()=>[],onDidCreateModel:vi.fn()},
}}))
vi.mock('@/stores/codeStudio',()=>({useCodeStudioStore:{getState:()=>({documents:mock.documents})}}))
vi.mock('@/stores/codeStudioLsp',()=>({useCodeStudioLspStore:{getState:()=>({status:{}}),subscribe:vi.fn()}}))
vi.mock('@/stores/ideLanguageServers',()=>({isServerReady:()=>mock.ready,serverLanguageForEditor:()=> 'java'}))
vi.mock('@/stores/ideExtensions',()=>({extensionLanguageForPath:()=>undefined}))
vi.mock('@/lib/code-studio-api',()=>({}))
vi.mock('@/lib/code-studio-lsp-api',()=>({requestCompletion:(...args:unknown[])=>mock.request(...args)}))
vi.mock('./codeStudioLspSync',()=>({flushCodeStudioDocument:(...args:unknown[])=>mock.flush(...args),currentCodeStudioDocumentVersion:()=>null}))
vi.mock('./codeStudioDependencySource',()=>({}))
vi.mock('./codeStudioWorkspaceEdits',()=>({}))
vi.mock('./codeStudioLintActions',()=>({}))
vi.mock('./codeStudioAIFixRunner',()=>({}))
import { registerCodeStudioLanguageFeatures } from './codeStudioLanguageFeatures'
const source='class Demo { static final int LIMIT=42; void work(int input) { int local=1; loc } }'
const offset=source.indexOf(' loc }')+4
const model={uri:{toString:()=> 'file:///Demo.java#session=s'},getLanguageId:()=> 'java',getValue:()=> source,getOffsetAt:()=>offset,getWordUntilPosition:()=>({word:'loc',startColumn:offset-2,endColumn:offset+1})} as unknown as monaco.editor.ITextModel
const token={isCancellationRequested:false,onCancellationRequested:()=>({dispose:vi.fn()})} as unknown as monaco.CancellationToken
registerCodeStudioLanguageFeatures(['java'])
beforeEach(()=>{
 mock.ready=false;mock.request.mockReset();mock.flush.mockClear()
 mock.documents=[{document:{uri:'file:///Demo.java',id:'d',sessionId:'s',language:'java',relativePath:'Demo.java'},buffer:source}]
})
it('provides local Java completions through the real provider without IPC or buffer sync',async()=>{
 const provider=mock.providers.get('CompletionItem') as monaco.languages.CompletionItemProvider
 const result=await provider.provideCompletionItems(model,{lineNumber:1,column:offset+1} as never,{} as never,token)
 expect(result?.suggestions.map(x=>x.label)).toContain('local')
 expect(result?.suggestions.find(x=>x.label==='local')?.range).toMatchObject({startColumn:offset-2,endColumn:offset+1})
 expect(mock.request).not.toHaveBeenCalled();expect(mock.flush).not.toHaveBeenCalled()
})
it('switches to exactly the JDT completion results when ready',async()=>{
 mock.ready=true
 mock.request.mockResolvedValue({version:1,items:[{label:'fromJDT',kind:6,insertText:'fromJDT'}]})
 const provider=mock.providers.get('CompletionItem') as monaco.languages.CompletionItemProvider
 const result=await provider.provideCompletionItems(model,{lineNumber:1,column:offset+1} as never,{} as never,token)
 expect(result?.suggestions.map(x=>x.label)).toEqual(['fromJDT'])
 expect(mock.flush).toHaveBeenCalledWith('d')
})
it('serves current-file symbols without asking the server',async()=>{
 const provider=mock.providers.get('DocumentSymbol') as monaco.languages.DocumentSymbolProvider
 const result=await provider.provideDocumentSymbols(model,token)
 expect(result?.[0].name).toBe('Demo')
 expect(result?.[0].children?.some(x=>x.name==='work')).toBe(true)
 expect(mock.flush).not.toHaveBeenCalled()
})
