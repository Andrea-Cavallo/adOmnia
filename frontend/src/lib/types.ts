export interface KVRow {
  id: string
  key: string
  value: string
  enabled: boolean
}

export interface RequestBody {
  id: string
  name: string
  type: 'none' | 'raw' | 'urlencoded' | 'formdata' | 'graphql'
  raw: string
  lang: 'json' | 'xml' | 'text' | 'html' | 'javascript'
  form: KVRow[]
  graphqlVariables?: string
}

export interface RequestAuth {
  type: 'none' | 'bearer' | 'basic' | 'apikey' | 'oauth2' | 'aws4' | 'digest'
  token: string
  username: string
  password: string
  oauth2GrantType?: string
  oauth2TokenUrl?: string
  oauth2AuthUrl?: string
  oauth2ClientId?: string
  oauth2ClientSecret?: string
  oauth2Scope?: string
  oauth2RedirectUri?: string
  oauth2AuthCode?: string
  oauth2CodeVerifier?: string
  oauth2RefreshToken?: string
  oauth2ExpiresAt?: number | null
  oidcIssuerUrl?: string
  oidcDiscoveryStatus?: 'idle' | 'loading' | 'success' | 'error'
  oidcDiscoveryError?: string
  oidcDiscovery?: {
    issuer: string
    authorizationEndpoint: string
    tokenEndpoint: string
    userinfoEndpoint?: string
    jwksUri: string
    endSessionEndpoint?: string
    scopesSupported?: string[]
    responseTypesSupported?: string[]
    codeChallengeMethodsSupported?: string[]
  }
  oidcIdToken?: string
  oidcNonce?: string
  oidcSessionExpiresAt?: number | null
  oidcUserClaims?: Record<string, unknown>
  oidcValidationError?: string
  awsAccessKeyId?: string
  awsSecretKey?: string
  awsRegion?: string
  awsService?: string
  awsSessionToken?: string
}

/** A documented response header captured from an OpenAPI spec on import. */
export interface OpenAPIResponseHeader {
  name: string
  description?: string
  example?: string
}

/** A documented response body example captured from an OpenAPI spec on import. */
export interface OpenAPIResponseExample {
  name: string
  lang: RequestBody['lang']
  raw: string
}

/** Documented response for one status code, preserved from an OpenAPI import. */
export interface OpenAPIResponseDoc {
  status: string
  description?: string
  contentType?: string
  headers?: OpenAPIResponseHeader[]
  examples?: OpenAPIResponseExample[]
}

/**
 * The full security context of an imported operation. A request only *sends* one
 * `auth`, but specs often allow alternatives (e.g. OAuth2 OR ApiKey) with several
 * flows and scopes — this keeps all of them so nothing is lost on round-trip.
 */
export interface OpenAPISecurityDoc {
  schemes: Record<string, unknown>
  requirements?: Array<Record<string, string[]>>
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'CONNECT' | 'TRACE' | 'WS' | 'SOAP'

export interface RequestItem {
  id: string
  name: string
  description?: string
  type: 'request'
  method: HttpMethod
  url: string
  params: KVRow[]
  pathParams?: KVRow[]
  headers: KVRow[]
  bodies: RequestBody[]
  activeBodyIdx: number
  auth: RequestAuth
  cookies?: KVRow[]
  scripts?: { pre?: string; post?: string; tests?: string }
  timeout?: number
  followRedirects?: boolean
  _openapiPath?: string
  _xExtensions?: Record<string, unknown>
  _openapiResponses?: OpenAPIResponseDoc[]
  _openapiSecurity?: OpenAPISecurityDoc
  assertions?: RequestAssertion[]
  psd2?: PSD2RequestConfig
}

export type PSD2Operation = 'ais-consent' | 'pis-payment' | 'fcs-confirmation'

export interface PSD2RequestConfig {
  enabled: boolean
  operation: PSD2Operation
  qwacPath: string
  qwacPasswordRef: string
  qsealPath: string
  qsealPasswordRef: string
  keyId: string
  sign: boolean
}

export type AssertionOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'not_contains' | 'regex' | 'exists' | 'type'

export interface RequestAssertion {
  id: string
  enabled: boolean
  target: 'statusCode' | 'responseTime' | 'header' | 'bodyText' | 'jsonPath' | 'xmlPath' | 'contentType' | 'schema' | 'arrayLength'
  operator: AssertionOperator
  path?: string
  headerName?: string
  expected?: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array'
}

export interface AssertionResult {
  assertionId: string
  passed: boolean
  label: string
  actual: string
  expected: string
}

export interface ScriptTestResult {
  name: string
  passed: boolean
  error?: string
}

export interface ScriptRunResult {
  phase: 'pre' | 'post' | 'tests'
  passed: boolean
  durationMs: number
  tests: ScriptTestResult[]
  logs: string[]
  error?: string
}

export interface ScriptRunSummary {
  runs: ScriptRunResult[]
  mutations: Record<string, string | null>
}

export interface FolderItem {
  id: string
  name: string
  type: 'folder'
  children: TreeNode[]
}

export type TreeNode = RequestItem | FolderItem

export interface Collection {
  id: string
  name: string
  color?: string
  children: TreeNode[]
  _openapiSpec?: string
}

export interface CollectionWorkspace {
  id: string
  name: string
  collections: Collection[]
  createdAt: string
  updatedAt: string
}

export interface EnvVariable {
  id: string
  key: string
  value: string
  enabled: boolean
  type?: 'text' | 'secret'
}

export interface Environment {
  id: string
  name: string
  private?: boolean
  variables: EnvVariable[]
}

export interface ResponseData {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  bodyBase64?: string
  contentType: string
  ms: number
  size: number
  error?: { code: string; message: string }
  scripts?: ScriptRunSummary
}

export interface RequestHistoryEntry {
  id: string
  recordedAt: string | null
  request?: RequestItem
  response: ResponseData
}

export interface Tab {
  id: string
  request: RequestItem
  collectionId?: string
  workspaceId?: string
  dirty: boolean
  response: ResponseData | null
  loading: boolean
}

export interface ContractValidationResult {
  valid: boolean
  errors: ContractError[]
  warnings: ContractWarning[]
  hasSpec: boolean
}

export interface ContractError {
  category: 'status' | 'contentType' | 'header' | 'body'
  message: string
  detail?: string
}

export interface ContractWarning {
  category: 'unknownStatus' | 'unexpectedHeader'
  message: string
}

// ─── Visual Test Orchestration (P16) ───────────────────────────────────────

export interface MockCondition {
  source: 'query' | 'header' | 'path_param' | 'body_jsonpath'
  field: string
  operator: 'eq' | 'neq' | 'contains' | 'not_contains' | 'regex' | 'exists' | 'not_exists'
  value: string
}

export type BlockType = 'request' | 'assert' | 'setvar' | 'if' | 'loop'

export type BlockRunState = 'idle' | 'running' | 'passed' | 'failed' | 'skipped'

export interface RequestBlock {
  type: 'request'
  id: string
  collectionItemId: string
  label: string
  extractVars: { varName: string; jsonPath: string }[]
}

export interface AssertBlock {
  type: 'assert'
  id: string
  label: string
  source: 'body' | 'status' | 'header'
  field: string
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'exists'
  expected: string
}

export interface SetVarBlock {
  type: 'setvar'
  id: string
  varName: string
  expression: string
}

export interface IfBlock {
  type: 'if'
  id: string
  condition: string
  thenBlocks: TestBlock[]
  elseBlocks: TestBlock[]
}

export interface LoopBlock {
  type: 'loop'
  id: string
  count: number
  blocks: TestBlock[]
}

export type TestBlock = RequestBlock | AssertBlock | SetVarBlock | IfBlock | LoopBlock

export interface VisualTest {
  id: string
  name: string
  blocks: TestBlock[]
  envId: string | null
}

export interface BlockResult {
  blockId: string
  state: BlockRunState
  message: string
  durationMs: number
}

export interface VisualTestResult {
  testId: string
  blockResults: BlockResult[]
  passed: boolean
  durationMs: number
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function blankKVRow(): KVRow {
  return { id: uid(), key: '', value: '', enabled: true }
}

export function blankEnvVar(): EnvVariable {
  return { id: uid(), key: '', value: '', enabled: true, type: 'text' }
}

export interface HostEntry {
  id: string
  host: string     // "hostname" o "hostname:porta"
  ip: string
  enabled: boolean
  note: string
}

export interface HostsProfile {
  id: string
  name: string
  entries: HostEntry[]
}

export function blankHostEntry(): HostEntry {
  return { id: uid(), host: '', ip: '', enabled: true, note: '' }
}

export function blankBody(name = 'Body 1'): RequestBody {
  return { id: uid(), name, type: 'none', raw: '', lang: 'json', form: [] }
}

export function blankAuth(): RequestAuth {
  return { type: 'none', token: '', username: '', password: '' }
}

export function blankRequest(method: HttpMethod = 'GET', name = 'New Request'): RequestItem {
  return {
    id: uid(),
    name,
    description: '',
    type: 'request',
    method,
    url: '',
    params: [blankKVRow()],
    headers: [blankKVRow()],
    cookies: [blankKVRow()],
    bodies: [blankBody()],
    activeBodyIdx: 0,
    auth: blankAuth(),
    timeout: 0,
    followRedirects: true,
  }
}
