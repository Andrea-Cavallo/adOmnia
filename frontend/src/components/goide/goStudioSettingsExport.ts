import { getGoIDEToolchainSettings, type GoIDEToolchainSettings } from '@/lib/goide-api'
import { saveBase64File } from '@/lib/fileUtils'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useSettingsStore, type AppSettings } from '@/stores/settings'
import { networkModeOf, toolchainFormFromEnv } from './goStudioToolchainEnv'

const SECRET_NAME = /TOKEN|SECRET|PASSW|PASS$|KEY|AUTH|CREDENTIAL|COOKIE/i
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi

export interface GoStudioSettingsReportInput {
  projectName: string
  trusted: boolean
  toolchain: GoIDEToolchainSettings
  ai: Pick<AppSettings['ai'], 'enabled' | 'provider' | 'model' | 'baseURL' | 'apiKey' | 'credentialMode' | 'modelUpdatePolicy' | 'gatewayEnabled' | 'gatewayPort' | 'workspaceActionsEnabled'>
  linter: { kind?: string; available?: boolean; configPath?: string } | null
  exportedAt: string
}

/** Toglie credenziali da un valore: userinfo negli URL; i nomi "segreti" perdono il valore intero. */
export function redactSetting(name: string, value: string): string {
  if (SECRET_NAME.test(name)) return value ? '[redacted]' : ''
  return value.replace(URL_USERINFO, '$1***@')
}

function redactEnvironment(environment: Record<string, string | undefined> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(environment ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, redactSetting(name, value)]))
}

function toolchainSection(config: GoIDEToolchainSettings['global'] | null | undefined) {
  if (!config) return null
  return {
    goBinary: config.goBinary || '(PATH)',
    networkMode: networkModeOf(toolchainFormFromEnv(config.environment)),
    environment: redactEnvironment(config.environment),
  }
}

/**
 * Rapporto leggibile (JSON con chiavi stabili) di cosa Go Studio può contattare e con quali impostazioni,
 * per privacy review e audit. Non contiene chiavi, token, password né percorsi della home.
 */
export function goStudioSettingsReport(input: GoStudioSettingsReportInput): string {
  const { ai } = input
  const report = {
    format: 'adomnia-go-studio-settings',
    version: 1,
    exportedAt: input.exportedAt,
    project: { name: input.projectName, toolsTrusted: input.trusted },
    telemetry: 'none: adOmnia sends no telemetry or analytics',
    toolchain: {
      effective: input.toolchain.project ? 'project' : 'global',
      project: toolchainSection(input.toolchain.project),
      global: toolchainSection(input.toolchain.global),
    },
    ai: {
      enabled: ai.enabled,
      provider: ai.provider,
      model: ai.model,
      baseURL: redactSetting('baseURL', ai.baseURL ?? ''),
      credentialMode: ai.credentialMode,
      apiKeyStored: !!ai.apiKey,
      modelUpdatePolicy: ai.modelUpdatePolicy,
      localGateway: ai.gatewayEnabled ? { enabled: true, port: ai.gatewayPort, bind: 'loopback' } : { enabled: false },
      workspaceActionsEnabled: ai.workspaceActionsEnabled,
    },
    linter: input.linter ? { kind: input.linter.kind ?? '', available: !!input.linter.available, projectConfig: !!input.linter.configPath } : null,
  }
  return `${JSON.stringify(report, null, 2)}\n`
}

function utf8Base64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Raccoglie le impostazioni della sessione e le salva con il dialogo nativo "Salva con nome". */
export async function exportGoStudioSettingsReport(sessionId: string): Promise<void> {
  const session = useGoIDEStore.getState().sessions.find((item) => item.id === sessionId)
  if (!session) return
  try {
    const projectName = session.project.rootPath.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
    const text = goStudioSettingsReport({
      projectName,
      trusted: session.project.authorization === 'tooling-permitted',
      toolchain: await getGoIDEToolchainSettings(sessionId),
      ai: useSettingsStore.getState().settings.ai,
      linter: useGoIDELspStore.getState().linter[sessionId] ?? null,
      exportedAt: new Date().toISOString(),
    })
    const path = await saveBase64File(`${projectName}-go-studio-settings.json`, utf8Base64(text))
    if (path) useGoIDELspStore.setState({ message: `Settings report saved to ${path}. It contains no keys, tokens or passwords.` })
  } catch (error) {
    useGoIDELspStore.setState({ message: error instanceof Error ? error.message : String(error) })
  }
}
