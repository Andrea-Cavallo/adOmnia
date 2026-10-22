import { describe, expect, it } from 'vitest'
import { isPythonManifest, normalizePythonName, parsePythonManifest, pythonRequirementStatuses, pythonVersionEdit } from './pythonManifestSecurity'
import type { SecurityFinding } from '../securityIntel-api'

const finding = (name: string, version: string, id: string, band: string, fixed?: string, ignored = false) => ({
  advisory: { id, summary: `${id} summary` }, component: { name, version }, risk: { band }, remediation: { fixedVersion: fixed }, ignored: ignored ? { reason: 'x' } : null,
}) as unknown as SecurityFinding

const REQUIREMENTS = [
  '# runtime',
  'fastapi==0.115.0',
  'uvicorn>=0.30',
  'requests[socks]==2.32.3  # client',
  '-r requirements-dev.txt',
].join('\n')

describe('parsePythonManifest', () => {
  it('reads pinned requirements with their exact version columns', () => {
    const lines = parsePythonManifest('api/requirements.txt', REQUIREMENTS)
    expect(lines.map((line) => `${line.name}@${line.version}:${line.line}`)).toEqual(['fastapi@0.115.0:2', 'requests@2.32.3:4'])
    const request = lines[1]
    expect(REQUIREMENTS.split('\n')[3].slice(request.versionStart - 1, request.versionEnd - 1)).toBe('2.32.3')
  })

  it('reads inline pins in a pyproject dependency array', () => {
    const source = [
      '[project]',
      'dependencies = [',
      '  "fastapi==0.115.0",',
      '  "pydantic>=2.8",',
      ']',
      '[dependency-groups]',
      'dev = ["pytest==8.3.0"]',
    ].join('\n')
    const lines = parsePythonManifest('pyproject.toml', source)
    expect(lines.map((line) => `${line.name}@${line.version}:${line.line}`)).toEqual(['fastapi@0.115.0:3', 'pytest@8.3.0:7'])
    if (lines[0]) expect(source.split('\n')[2].slice(lines[0].versionStart - 1, lines[0].versionEnd - 1)).toBe('0.115.0')
  })

  it('recognises only the manifests the PyPI adapter analyses', () => {
    expect(isPythonManifest('requirements.txt')).toBe(true)
    expect(isPythonManifest('requirements-dev.txt')).toBe(true)
    expect(isPythonManifest('service\\pyproject.toml')).toBe(true)
    expect(isPythonManifest('service/app.py')).toBe(false)
    expect(isPythonManifest('requirements.in')).toBe(false)
  })
})

describe('pythonRequirementStatuses', () => {
  const lines = parsePythonManifest('requirements.txt', REQUIREMENTS)

  it('matches findings by normalized name and version, worst first', () => {
    const statuses = pythonRequirementStatuses(lines, [
      finding('fastapi', '0.115.0', 'GHSA-1', 'medium', '0.115.1'),
      finding('fastapi', '0.115.0', 'GHSA-2', 'high', '0.116.0'),
      finding('FastAPI', '0.111.0', 'GHSA-3', 'critical', '0.112.0'),
      finding('fastapi', '0.115.0', 'GHSA-4', 'critical', '0.115.2', true),
    ])
    const fastapi = statuses[0]
    expect(fastapi.vulnerabilities.map((item) => item.id)).toEqual(['GHSA-2', 'GHSA-1'])
    expect(fastapi.worst).toBe('high')
    expect(fastapi.fixVersion).toBe('0.116.0')
  })

  it('leaves unpinned requirements without markers', () => {
    const statuses = pythonRequirementStatuses(lines, [finding('uvicorn', '0.30.0', 'GHSA-9', 'high')])
    expect(statuses[1]?.worst).toBeNull()
  })
})

describe('pythonVersionEdit', () => {
  it('replaces only the version token and refuses a changed line', () => {
    const line = REQUIREMENTS.split('\n')[3]
    const requirement = parsePythonManifest('requirements.txt', REQUIREMENTS)[1]
    expect(pythonVersionEdit(line, requirement, '2.32.6')).toEqual({ startColumn: requirement.versionStart, endColumn: requirement.versionEnd, text: '2.32.6' })
    expect(pythonVersionEdit(line.replace('2.32.3', '2.32.2'), requirement, '2.32.6')).toBeNull()
  })
})

describe('normalizePythonName', () => {
  it('uses PEP 503 normalization', () => {
    expect(normalizePythonName('PyMySQL')).toBe('pymysql')
    expect(normalizePythonName('typing_extensions')).toBe('typing-extensions')
    expect(normalizePythonName('zope.interface')).toBe('zope-interface')
  })
})
