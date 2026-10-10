import * as CollabBindings from '../../bindings/adomnia/collab'
import { Events } from '@wailsio/runtime'
import type { Invite, Participant, Share, Status } from '../../bindings/adomnia/internal/collab/models'

export type CollabStatus = Status
export type CollabParticipant = Participant
export type CollabInvite = Invite
export type CollabShare = Share
export type CollabRole = 'viewer' | 'editor' | 'controller'
export type CollabShareKind = 'collection' | 'request' | 'environments'

export interface CollabEvent {
  seq: number
  type: 'participants' | 'share' | 'closed' | 'error' | 'document' | 'project' | 'disconnected' | 'resumed'
  from?: string
  payload?: unknown
}

export const collabApi = {
  status: () => CollabBindings.Status(),
  localAddresses: async () => (await CollabBindings.LocalAddresses()) ?? [],
  host: (ip: string, port: number, name: string) => CollabBindings.Host(ip, port, name),
  createInvite: (role: CollabRole, ttlMinutes: number) => CollabBindings.CreateInvite(role, ttlMinutes),
  join: (code: string, name: string) => CollabBindings.Join(code, name),
  stop: () => CollabBindings.Stop(),
  resume: () => CollabBindings.Resume(),
  syncCollection: (sourceId:string,title:string,data:unknown) => CollabBindings.SyncCollection(sourceId,title,JSON.stringify(data)),
  setRole: (participantId: string, role: CollabRole) => CollabBindings.SetRole(participantId, role),
  revoke: (participantId: string) => CollabBindings.Revoke(participantId),
  openDocument: (id: string, initial: string) => CollabBindings.OpenDocument(id, initial),
  shareProject: (sessionId: string) => CollabBindings.ShareProject(sessionId),
  projectTree: () => CollabBindings.ProjectTree(),
  readProjectFile: (path: string) => CollabBindings.ReadProjectFile(path),
  validateProjectDocument: (path: string, content: string) => CollabBindings.ValidateProjectDocument(path, content),
  document: (message: { id: string; action: string; data?: string; updates?: string[] }) => CollabBindings.Document({ data: '', updates: [], ...message }),
  /** Ciò che lascerebbe davvero la macchina: i segreti sono già rimossi dal backend. */
  preview: (kind: CollabShareKind, title: string, data: unknown, secretVariables: string[] = []) => CollabBindings.PreviewShareWithSecrets(kind, title, JSON.stringify(data), secretVariables),
  share: (kind: CollabShareKind, title: string, data: unknown, secretVariables: string[] = []) => CollabBindings.ShareWithSecrets(kind, title, JSON.stringify(data), secretVariables),
}

export function subscribeCollabEvents(handler: (event: CollabEvent) => void): () => void {
  return Events.On('collab:event', (event) => handler(event.data as CollabEvent))
}
