import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ handoff: vi.fn(), open: vi.fn(), close: vi.fn(), read: vi.fn(), state: { documents: [] as any[], sessions: [{id: 's', project: {realPath: 'C:/project'}}] } }))
vi.mock('@/lib/goide-api', () => ({openGoIDEDocument: mocks.open, closeGoIDEDocument: mocks.close}))
vi.mock('@/stores/goide', () => ({useGoIDEStore: {getState: () => mocks.state}}))
vi.mock('@/lib/entities/dispatch', () => ({handoffToPanel: mocks.handoff}))
vi.mock('../../../bindings/adomnia/goide', () => ({ReadProjectKeystore: mocks.read}))
import { openProjectArtifact } from './projectArtifacts'
const ref = (path: string) => ({kind: 'artifact' as const, id: path, sessionId: 's', label: path, attrs: {path}})
beforeEach(() => {vi.clearAllMocks(); mocks.state.documents = []})
describe('project enterprise handoffs', () => {
 it('uses the unsaved SOAP buffer without touching disk', async () => {
  mocks.state.documents = [{document:{sessionId:'s',relativePath:'request.xml'},buffer:'<Envelope>unsaved</Envelope>'}]
  await openProjectArtifact(ref('request.xml'), 'security')
  expect(mocks.handoff).toHaveBeenCalledWith('soap', ref('request.xml'), 'security', {text:'<Envelope>unsaved</Envelope>', name:'request.xml'})
  expect(mocks.open).not.toHaveBeenCalled()
 })
 it('reads JKS and PKCS12 as opaque bytes', async () => {
  mocks.read.mockResolvedValue('AP8=')
  for (const path of ['client.jks','client.p12','client.pfx']) {
   await openProjectArtifact(ref(path),'inspect')
   expect(mocks.read).toHaveBeenLastCalledWith('s',path)
   expect(mocks.handoff).toHaveBeenLastCalledWith('powertools',ref(path),'keystore',{name:path,base64:'AP8='})
  }
  expect(mocks.open).not.toHaveBeenCalled()
 })
 it('proposes mTLS settings without reading or changing certificate contents', async () => {
  await openProjectArtifact(ref('tls/client.pem'), 'mtls')
  expect(mocks.handoff).toHaveBeenCalledWith('settings',ref('tls/client.pem'),'mtls',{certificate:'C:/project/tls/client.pem'})
  expect(mocks.read).not.toHaveBeenCalled()
 })
})
