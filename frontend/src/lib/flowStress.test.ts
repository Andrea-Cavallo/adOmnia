import { describe, expect, it } from 'vitest'
import { DEFAULT_STRESS_CONFIG, MAX_STRESS_VUS, runFlowStress, validateStressConfig, type FlowStressConfig } from './flowStress'
import type { FlowGraphDefinition } from './flowStorage'

const config = (patch: Partial<FlowStressConfig>): FlowStressConfig => ({ ...DEFAULT_STRESS_CONFIG, ...patch })

// The run itself is the Go engine (internal/loadtest: flow_test.go, engine_test.go); here only
// what the dock checks before sending the plan.
describe('flow stress config', () => {
  it('accepts the engine limits and rejects what it cannot run', () => {
    expect(validateStressConfig(DEFAULT_STRESS_CONFIG)).toEqual([])
    expect(validateStressConfig(config({ vus: MAX_STRESS_VUS }))).toEqual([])
    expect(validateStressConfig(config({ vus: MAX_STRESS_VUS + 1 }))).toHaveLength(1)
    expect(validateStressConfig(config({ mode: 'duration', durationS: 0 }))).toHaveLength(1)
    expect(validateStressConfig(config({ mode: 'stages', stages: [] }))).toHaveLength(1)
    expect(validateStressConfig(config({ mode: 'stages', stages: [{ id: 'a', label: 'A', durationS: 10, targetVus: 5, rampS: 20, measure: true }] }))).toHaveLength(1)
  })

  it('does not start a run with an invalid config', async () => {
    await expect(runFlowStress({ nodes: [], edges: [] } as unknown as FlowGraphDefinition, config({ vus: 0 }), { initialVars: {} })).rejects.toThrow('Virtual users')
  })
})
