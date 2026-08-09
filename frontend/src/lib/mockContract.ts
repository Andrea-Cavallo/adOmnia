import { validateContract } from '@/lib/contractValidator'
import type { Collection, ResponseData, TreeNode } from '@/lib/types'

export interface MockContractResponse {
  id: string
  name: string
  status: number
  headers: Record<string, string>
  body: string
  isActive: boolean
}

export interface MockContractEndpoint {
  id: string
  path: string
  method: string
  sourceCollectionId?: string
  sourceRequestId?: string
  responses: MockContractResponse[]
}

export interface MockContractCheck {
  endpointId: string
  endpointPath: string
  responseId: string
  responseName: string
  status: number
  result: ReturnType<typeof validateContract>
}

function findRequest(nodes: TreeNode[], requestId: string): Extract<TreeNode, { type: 'request' }> | null {
  for (const node of nodes) {
    if (node.type === 'folder') {
      const found = findRequest(node.children, requestId)
      if (found) return found
    } else if (node.id === requestId) {
      return node
    }
  }
  return null
}

function pathShape(path: string): string {
  return path
    .replace(/\{[^}]+\}/g, '{}')
    .replace(/:[A-Za-z_][\w-]*/g, '{}')
    .replace(/\/+$/, '') || '/'
}

function methodForOpenApi(method: string): string {
  // QUERY is adOmnia's safe-query request method. In an OpenAPI document the
  // same operation is represented by GET.
  return method === 'QUERY' ? 'GET' : method
}

function findPathByShape(nodes: TreeNode[], endpoint: MockContractEndpoint): string | undefined {
  const expectedShape = pathShape(endpoint.path)
  const expectedMethod = methodForOpenApi(endpoint.method)
  for (const node of nodes) {
    if (node.type === 'folder') {
      const found = findPathByShape(node.children, endpoint)
      if (found) return found
    } else if (
      node._openapiPath
      && node.method === expectedMethod
      && pathShape(node._openapiPath) === expectedShape
    ) {
      return node._openapiPath
    }
  }
  return undefined
}

export function openApiPathForMockEndpoint(endpoint: MockContractEndpoint, collection: Collection): string | undefined {
  if (endpoint.sourceRequestId) {
    const source = findRequest(collection.children, endpoint.sourceRequestId)
    if (source?._openapiPath) return source._openapiPath
  }
  return findPathByShape(collection.children, endpoint)
}

function responseData(response: MockContractResponse): ResponseData {
  const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]))
  return {
    status: response.status,
    statusText: '',
    headers,
    body: response.body,
    contentType: headers['content-type'] ?? '',
    ms: 0,
    size: new Blob([response.body]).size,
  }
}

export function validateMockEndpoint(endpoint: MockContractEndpoint, collection: Collection): MockContractCheck[] {
  const openApiPath = openApiPathForMockEndpoint(endpoint, collection)
  if (!openApiPath) return []

  return endpoint.responses
    .filter((response) => response.isActive)
    .map((response) => ({
      endpointId: endpoint.id,
      endpointPath: endpoint.path,
      responseId: response.id,
      responseName: response.name,
      status: response.status,
      result: validateContract(collection._openapiSpec, openApiPath, methodForOpenApi(endpoint.method), responseData(response)),
    }))
}

export function validateMockEndpoints(endpoints: MockContractEndpoint[], collection: Collection | null): MockContractCheck[] {
  if (!collection?._openapiSpec) return []
  return endpoints
    .filter((endpoint) => !endpoint.sourceCollectionId || endpoint.sourceCollectionId === collection.id)
    .flatMap((endpoint) => validateMockEndpoint(endpoint, collection))
}
