import { describe, expect, it } from 'vitest'
import fixtureRaw from '../../../docs/fixtures/collection-contract-freeze.v1.adomnia.json?raw'

type FixtureRequest = {
  id: string
  method: string
  bodies: Array<{ type: string }>
  auth: { type: string }
  assertions?: unknown[]
  scripts?: { pre?: string; post?: string; tests?: string }
  _openapiPath?: string
}

type FixtureNode = FixtureRequest | {
  id: string
  type: 'folder'
  children: FixtureNode[]
}

function walkRequests(nodes: FixtureNode[]): FixtureRequest[] {
  return nodes.flatMap((node) => {
    if ('type' in node && node.type === 'folder') return walkRequests(node.children)
    return [node as FixtureRequest]
  })
}

describe('collection contract freeze fixture', () => {
  const fixture = JSON.parse(fixtureRaw)
  const collection = fixture.storage['collections/all'].workspaces[0].collections[0]
  const requests = walkRequests(collection.children)

  it('is a versioned Phase -1 fixture with stable storage envelopes', () => {
    expect(fixture.fixtureVersion).toBe(1)
    expect(fixture.storage['collections/all'].version).toBe(2)
    expect(fixture.storage['collections/all'].activeWorkspaceId).toBe('workspace-gap-closure')
    expect(fixture.storage['environments/all'].activeEnvId).toBe('env-dev')
    expect(fixture.storage['tabs/session-v1'].version).toBe(2)
  })

  it('covers the request shapes needed before file-based sync', () => {
    expect(requests.map((request) => request.method)).toEqual(expect.arrayContaining(['GET', 'POST', 'PATCH']))
    expect(requests.flatMap((request) => request.bodies.map((body) => body.type))).toEqual(
      expect.arrayContaining(['none', 'raw', 'urlencoded', 'graphql']),
    )
    expect(requests.map((request) => request.auth.type)).toEqual(
      expect.arrayContaining(['bearer', 'apikey', 'oauth2', 'aws4', 'digest']),
    )
    expect(requests.some((request) => request.assertions?.length)).toBe(true)
    expect(requests.some((request) => request.scripts?.tests || request.scripts?.pre || request.scripts?.post)).toBe(true)
    expect(requests.some((request) => request._openapiPath)).toBe(true)
  })

  it('covers text and secret environment variables', () => {
    const variables = fixture.storage['environments/all'].environments.flatMap(
      (env: { variables: Array<{ type?: string }> }) => env.variables,
    )
    expect(variables.map((variable: { type?: string }) => variable.type)).toEqual(expect.arrayContaining(['text', 'secret']))
    expect(variables.some((variable: { value?: string }) => variable.value?.startsWith('vault:'))).toBe(true)
  })
})
