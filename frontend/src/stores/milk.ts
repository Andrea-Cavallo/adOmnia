import {
  cancelMilkPrompt,
  getMilkSettings,
  getMilkStatus,
  installMilk,
  resetMilkSession,
  restartMilk,
  respondMilkPermission,
  saveMilkSettings,
  sendMilkPrompt,
  setMilkWorkspace,
  subscribeMilkEvents,
} from '@/lib/milk-api'
import { applyAgentChatEvent, createAgentChatStore, type AgentChatMessage, type AgentChatThread, type AgentToolActivity } from './agentChat'

export type MilkToolActivity = AgentToolActivity
export type MilkChatMessage = AgentChatMessage
export type MilkChatThread = AgentChatThread
export const applyMilkChatEvent = applyAgentChatEvent

// Lambdas, not references: the bindings are read only when a call happens.
export const useMilkStore = createAgentChatStore({
  status: () => getMilkStatus(),
  settings: () => getMilkSettings(),
  saveSettings: (settings) => saveMilkSettings(settings),
  restart: () => restartMilk(),
  setWorkspace: (root) => setMilkWorkspace(root),
  prompt: (request) => sendMilkPrompt(request),
  cancelPrompt: (token) => cancelMilkPrompt(token),
  resetSession: (root) => resetMilkSession(root),
  respondPermission: (requestId, allow) => respondMilkPermission(requestId, allow),
  subscribe: (handlers) => subscribeMilkEvents(handlers),
  install: () => installMilk(),
})
