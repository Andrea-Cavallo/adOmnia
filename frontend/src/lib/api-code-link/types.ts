import type { DevEntity } from '@/lib/devcontext-api'

/** One selected API comment/endpoint ↔ source handler relationship, shared by both panels. */
export interface ApiCodeLink {
  /** Code Studio session that owns the source side. Never borrowed from another project. */
  sessionId: string
  routeId: string
  method: string
  path: string
  /** Handler declaration, root-relative. */
  file: string
  line: number
  handler: string
  /** Request tab on the API side, when one exists. */
  requestTabId?: string
  origin: 'request' | 'code'
  createdAt: number
}

/** An endpoint that could be the other side of a link. */
export interface EndpointCandidate {
  sessionId: string
  projectName: string
  projectRoot: string
  route: DevEntity
  method: string
  path: string
  file: string
  line: number
  handler: string
  score: number
}

export interface LinkChoice {
  id: string
  label: string
  detail: string
  project?: string
  run: () => void | Promise<void>
}

/** A lightweight menu shown when several endpoints or handlers match. */
export interface LinkChooser {
  title: string
  description?: string
  choices: LinkChoice[]
}
