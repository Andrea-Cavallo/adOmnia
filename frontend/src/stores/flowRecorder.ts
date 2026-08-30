import { create } from 'zustand'
import { uid, type RequestAuth, type RequestItem, type ResponseData } from '@/lib/types'

export interface RecordedApiCall {
  id: string
  seq: number
  recordedAt: string
  sourceRequestId?: string
  environmentId: string | null
  environmentName: string | null
  /** The request as configured, deliberately never resolved with secret values. */
  request: RequestItem
  execution: { method: string; urlTemplate: string; status?: number; durationMs?: number; error?: string }
}

interface FlowRecorderState {
  recording: boolean
  startedAt: string | null
  calls: RecordedApiCall[]
  start: () => void
  stop: () => void
  cancel: () => void
  capture: (request: RequestItem, environment: { id: string; name: string } | null, response: ResponseData) => void
  take: () => RecordedApiCall[]
}

const secretAuthFields: Array<keyof RequestAuth> = [
  'token', 'password', 'oauth2ClientSecret', 'oauth2AuthCode', 'oauth2CodeVerifier',
  'oauth2RefreshToken', 'oidcIdToken', 'awsSecretKey', 'awsSessionToken',
]
const secretField = /(authorization|cookie|api[-_]?key|token|secret|password|credential|session)/i
const reference = /{{\s*[^}]+\s*}}|^(vault|secret):/i

function keepReference(value: string): string {
  return reference.test(value) ? value : ''
}

/** Exported for tests and for any future non-UI send entry point. */
export function sanitizeRecordedRequest(request: RequestItem): RequestItem {
  const auth = { ...request.auth }
  for (const field of secretAuthFields) auth[field] = keepReference(String(auth[field] ?? '')) as never
  const redactBody = (raw: string) => {
    try {
      const walk = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(walk)
        if (!value || typeof value !== 'object') return value
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, value]) => [key, secretField.test(key)
          ? (typeof value === 'string' ? keepReference(value) : '')
          : walk(value)]))
      }
      return JSON.stringify(walk(JSON.parse(raw)))
    } catch {
      // Raw XML, urlencoded and text bodies are not safely parseable as JSON.
      // Redact the common explicit secret shapes while retaining a variable/Vault
      // reference when it is the configured value.
      const redactValue = (value: string) => keepReference(value.trim())
      return raw
        .replace(/(<\s*(?:password|token|secret|api[-_]?key|credential|session)[^>]*>)([\s\S]*?)(<\s*\/\s*(?:password|token|secret|api[-_]?key|credential|session)\s*>)/gi, (_all, open: string, value: string, close: string) => `${open}${redactValue(value)}${close}`)
        .replace(/((?:password|token|secret|api[-_]?key|credential|session)\s*=\s*)([^&\s<]+)/gi, (_all, prefix: string, value: string) => `${prefix}${redactValue(value)}`)
        .replace(/((?:password|token|secret|api[-_]?key|credential|session)\s*:\s*)([^\s,;<>]+)/gi, (_all, prefix: string, value: string) => `${prefix}${redactValue(value)}`)
    }
  }
  return {
    ...request,
    headers: request.headers.map((header) => secretField.test(header.key)
      ? { ...header, value: keepReference(header.value) }
      : { ...header }),
    cookies: request.cookies?.map((cookie) => ({ ...cookie, value: keepReference(cookie.value) })),
    auth,
    // Snapshot nested structures so subsequent composer edits cannot mutate a recording.
    params: request.params.map((value) => ({ ...value })),
    pathParams: request.pathParams?.map((value) => ({ ...value })),
    bodies: request.bodies.map((body) => ({
      ...body,
      raw: redactBody(body.raw),
      form: body.form.map((value) => secretField.test(value.key) ? { ...value, value: keepReference(value.value) } : { ...value }),
    })),
    assertions: request.assertions?.map((value) => ({ ...value })),
    scripts: request.scripts ? { ...request.scripts } : undefined,
  }
}

export const useFlowRecorderStore = create<FlowRecorderState>((set, get) => ({
  recording: false,
  startedAt: null,
  calls: [],
  start: () => set({ recording: true, startedAt: new Date().toISOString(), calls: [] }),
  stop: () => set({ recording: false, startedAt: null }),
  cancel: () => set({ recording: false, startedAt: null, calls: [] }),
  capture: (request, environment, response) => {
    if (!get().recording) return
    set((state) => ({
      calls: [...state.calls, {
        id: uid(),
        seq: state.calls.length + 1,
        recordedAt: new Date().toISOString(),
        sourceRequestId: request.id || undefined,
        environmentId: environment?.id ?? null,
        environmentName: environment?.name ?? null,
        request: sanitizeRecordedRequest(request),
        execution: {
          method: request.method,
          urlTemplate: request.url,
          status: response.status || undefined,
          durationMs: response.ms,
          error: response.error?.message,
        },
      }],
    }))
  },
  take: () => {
    const calls = get().calls
    set({ recording: false, startedAt: null, calls: [] })
    return calls
  },
}))
