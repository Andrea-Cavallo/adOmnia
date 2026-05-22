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
  awsAccessKeyId?: string
  awsSecretKey?: string
  awsRegion?: string
  awsService?: string
  awsSessionToken?: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'CONNECT' | 'TRACE' | 'WS' | 'SOAP'

export interface RequestItem {
  id: string
  name: string
  type: 'request'
  method: HttpMethod
  url: string
  params: KVRow[]
  headers: KVRow[]
  bodies: RequestBody[]
  activeBodyIdx: number
  auth: RequestAuth
  scripts?: { pre?: string; post?: string; tests?: string }
  timeout?: number
  followRedirects?: boolean
  _openapiPath?: string
  assertions?: RequestAssertion[]
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
  variables: EnvVariable[]
}

export interface ResponseData {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  contentType: string
  ms: number
  size: number
  error?: { code: string; message: string }
  scripts?: ScriptRunSummary
}

export interface Tab {
  id: string
  request: RequestItem
  collectionId?: string
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

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function blankKVRow(): KVRow {
  return { id: uid(), key: '', value: '', enabled: true }
}

export function blankEnvVar(): EnvVariable {
  return { id: uid(), key: '', value: '', enabled: true, type: 'text' }
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
    type: 'request',
    method,
    url: '',
    params: [blankKVRow()],
    headers: [blankKVRow()],
    bodies: [blankBody()],
    activeBodyIdx: 0,
    auth: blankAuth(),
    timeout: 0,
    followRedirects: true,
  }
}
