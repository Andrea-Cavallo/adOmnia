import { create } from 'zustand'
import type { OtlpSpan } from '@/lib/otlp-api'
export const useGoStudioRuntimeContext = create<{ selected: { sessionId: string; span: OtlpSpan } | null }>(() => ({ selected: null }))
