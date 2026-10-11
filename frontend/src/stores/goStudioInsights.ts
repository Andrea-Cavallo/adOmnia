import { create } from 'zustand'
import type { GoIDEVulnReport } from '@/lib/goide-api'
import type { BinaryReport } from '../../bindings/adomnia/internal/languages/golang/models'

/** The last vulnerability scan and binary inspection of each project, for answers that combine them. */
export const useGoStudioInsights = create<{
  vulns: Record<string, GoIDEVulnReport>
  binaries: Record<string, BinaryReport>
  publishVulns: (sessionId: string, report: GoIDEVulnReport) => void
  publishBinary: (sessionId: string, report: BinaryReport) => void
}>((set) => ({
  vulns: {},
  binaries: {},
  publishVulns: (sessionId, report) => set((state) => ({ vulns: { ...state.vulns, [sessionId]: report } })),
  publishBinary: (sessionId, report) => set((state) => ({ binaries: { ...state.binaries, [sessionId]: report } })),
}))
