import { describe, expect, it } from 'vitest'
import { findToolTargets, toolFileKind } from './goStudioToolTargets'

describe('goStudioToolTargets', () => {
  it('recognises Makefile and Dockerfile names', () => {
    expect(toolFileKind('Makefile')).toBe('make')
    expect(toolFileKind('build/rules.mk')).toBe('make')
    expect(toolFileKind('Dockerfile')).toBe('docker')
    expect(toolFileKind('deploy/Dockerfile.dev')).toBe('docker')
    expect(toolFileKind('main.go')).toBeNull()
  })

  it('lists make targets but not variables, special targets, pattern rules or recipes', () => {
    const text = [
      'VERSION := 1.0', 'CC ?= gcc', '.PHONY: build test', '', 'build: deps', '\tgo build ./...',
      'test lint:', '\t@echo $(VERSION)', '%.o: %.c', 'define HELP', 'fake: target', 'endef', 'build: again',
    ].join('\n')
    const targets = findToolTargets('tools/Makefile', text)
    expect(targets.map((target) => [target.line, target.name])).toEqual([[5, 'build'], [7, 'test']])
    expect(targets[0]).toMatchObject({ kind: 'make', directory: 'tools', file: 'Makefile' })
  })

  it('offers named stages and the final build, with EXPOSE ports and ARG secrets', () => {
    const text = [
      'FROM registry/golang:1.24-alpine as builder', 'ARG username', 'ARG password', 'ARG nexus=https://x',
      'FROM alpine AS tools', 'FROM scratch', 'EXPOSE 8080 9090/udp',
    ].join('\n')
    const targets = findToolTargets('Dockerfile', text)
    expect(targets.map((target) => [target.line, target.name])).toEqual([[1, 'builder'], [5, 'tools'], [6, '']])
    expect(targets[2].ports).toEqual(['8080:8080', '9090:9090/udp'])
    expect(targets[0].buildArgs).toEqual([
      { key: 'username', value: '', secret: false },
      { key: 'password', value: '', secret: true },
      { key: 'nexus', value: 'https://x', secret: false },
    ])
  })

  it('skips unnamed intermediate stages', () => {
    const targets = findToolTargets('Dockerfile', 'FROM golang\nRUN go build\nFROM alpine\n')
    expect(targets.map((target) => target.line)).toEqual([3])
  })
})

describe('compose targets', () => {
  it('recognises compose file names', () => {
    for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'docker-compose.dev.yml', 'resources/docker_compose/docker-compose-local.yml']) {
      expect(toolFileKind(name)).toBe('compose')
    }
    expect(toolFileKind('pipeline.yaml')).toBeNull()
  })

  it('puts ▶ on services: and on each service, not on nested keys', () => {
    const text = [
      'version: "3.9"', 'services:', '  api:', '    image: app', '    ports:', '      - "8080:8080"', '  # comment', '  db:', '    image: postgres',
      'volumes:', '  data:',
    ].join('\n')
    const targets = findToolTargets('deploy/docker-compose.yml', text)
    expect(targets.map((target) => [target.line, target.name])).toEqual([[2, ''], [3, 'api'], [8, 'db']])
    expect(targets[0]).toMatchObject({ kind: 'compose', directory: 'deploy', file: 'docker-compose.yml' })
  })
})
