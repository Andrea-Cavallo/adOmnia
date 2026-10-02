import { describe, expect, it } from 'vitest'
import { DEFAULT_BROKER_WORKSPACE, parseBrokerWorkspace } from './brokerWorkspace'

describe('Broker Studio workspace recovery', () => {
  it('restores active protocol, saved profile and Kafka resource tab', () => {
    expect(parseBrokerWorkspace(JSON.stringify({
      version: 1,
      protocol: 'nats',
      activeProfileId: 'profile-7',
      kafkaTab: 'groups',
    }))).toEqual({ version: 1, protocol: 'nats', activeProfileId: 'profile-7', kafkaTab: 'groups' })
  })

  it('rejects corrupt or unsupported workspace values', () => {
    expect(parseBrokerWorkspace('{broken')).toEqual(DEFAULT_BROKER_WORKSPACE)
    expect(parseBrokerWorkspace(JSON.stringify({ protocol: 'ftp', activeProfileId: 4, kafkaTab: 'secrets' }))).toEqual(DEFAULT_BROKER_WORKSPACE)
  })
})
