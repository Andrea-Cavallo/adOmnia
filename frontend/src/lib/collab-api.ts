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
  type: 'participants' | 'share' | 'closed' | 'error'
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
  setRole: (participantId: string, role: CollabRole) => CollabBindings.SetRole(participantId, role),
  revoke: (participantId: string) => CollabBindings.Revoke(participantId),
  /** Ciò che lascerebbe davvero la macchina: i segreti sono già rimossi dal backend. */
  preview: (kind: CollabShareKind, title: string, data: unknown) => CollabBindings.PreviewShare(kind, title, JSON.stringify(data)),
  share: (kind: CollabShareKind, title: string, data: unknown) => CollabBindings.Share(kind, title, JSON.stringify(data)),
}

export function subscribeCollabEvents(handler: (event: CollabEvent) => void): () => void {
  return Events.On('collab:event', (event) => handler(event.data as CollabEvent))
}
