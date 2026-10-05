import { describe, expect, it } from 'vitest'
import type { GoIDEArchitecture } from '@/lib/goide-api'
import { analyzeContextPropagation } from './goStudioContextAnalysis'
import { fileContextGraph, projectContextGraph } from './goStudioContextGraph'

const site = (line: number) => ({ relativePath: 'api/api.go', line, column: 1 })

describe('context graph', () => {
  it('marks a cross-package broken chain from the typed report', () => {
    const report = {
      functions: [
        { id: 'api.Handle', name: 'Handle', package: 'example.com/x/api', context: true, site: site(3) },
        { id: 'api.Cron', name: 'Cron', package: 'example.com/x/api', site: site(9) },
        { id: 'repo.Find', name: 'Find', package: 'example.com/x/repo', context: true, site: site(1) },
      ],
      contextCalls: [
        { from: 'api.Handle', to: 'repo.Find', origin: 'param', site: site(4) },
        { from: 'api.Handle', to: 'repo.Find', origin: 'root', site: site(5) },
        { from: 'api.Cron', to: 'repo.Find', origin: 'root', site: site(10) },
      ],
    } as unknown as GoIDEArchitecture
    const graph = projectContextGraph(report, 'example.com/x')
    expect(graph.breaks).toEqual([{ from: 'Handle', to: 'Find', crossPackage: true, site: site(5) }])
    expect(graph.links).toEqual([{ from: 'api.Handle', to: 'repo.Find', value: 2 }, { from: 'api.Cron', to: 'repo.Find', value: 1 }])
    expect(Object.fromEntries(graph.nodes.map((node) => [node.id, [node.data.tone, node.data.subtitle]]))).toEqual({
      'repo.Find': ['plain', 'repo'], 'api.Handle': ['broken', 'api'], 'api.Cron': ['root', 'api'],
    })
  })

  it('draws only the functions of the file that pass a context', () => {
    const graph = fileContextGraph(analyzeContextPropagation('func a(ctx context.Context) {\n\tb(ctx)\n}\nfunc b(ctx context.Context) {\n}\nfunc c() {\n}\n'))
    expect(graph.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(graph.links).toEqual([{ from: 'a', to: 'b', value: 1 }])
  })
})
