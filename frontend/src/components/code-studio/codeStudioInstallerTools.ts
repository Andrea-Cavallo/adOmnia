import { detectGoIDEGoTool, installGoIDEGoModule } from '@/lib/code-studio-api'
import { languageServers, previewServerInstall } from '@/lib/ide-servers-api'
import { strixInfo, strixInstall, strixInstallPlan, strixStatus, isStrixActive } from '@/lib/strix-api'
import { useIdeLanguageServersStore } from '@/stores/ideLanguageServers'
import { beginToolInstall, endToolInstall } from '@/stores/codeStudioToolInstall'

/** Everything adOmnia can download for the IDE, in one list: the Installer dialog and its tests read only this. */
export type InstallerGroup = 'servers' | 'diagnostics' | 'debug' | 'security' | 'tools'

export type InstallerSource =
  | { kind: 'module'; binary: string; module: string }
  | { kind: 'server'; language: string }
  | { kind: 'strix' }

export interface InstallerTool {
  id: string
  name: string
  group: InstallerGroup
  purpose: string
  source: InstallerSource
}

export const INSTALLER_GROUPS: ReadonlyArray<{ id: InstallerGroup; label: string; hint: string }> = [
  { id: 'servers', label: 'Language servers', hint: 'Completion, navigation, hover, rename, refactoring' },
  { id: 'diagnostics', label: 'Linters & diagnostics', hint: 'Problems, lint on save, quick fixes' },
  { id: 'debug', label: 'Run & Debug', hint: 'Breakpoints, stepping, variables' },
  { id: 'security', label: 'Security', hint: 'Vulnerabilities your code actually reaches, AI pentest' },
  { id: 'tools', label: 'Go tools', hint: 'Imports, mocks, generated code' },
]

export const INSTALLER_TOOLS: ReadonlyArray<InstallerTool> = [
  { id: 'gopls', name: 'gopls', group: 'servers', purpose: 'Go completion, navigation, refactoring', source: { kind: 'module', binary: 'gopls', module: 'golang.org/x/tools/gopls@latest' } },
  { id: 'web', name: 'TypeScript / JavaScript / HTML / CSS / JSON', group: 'servers', purpose: 'Web language servers (npm)', source: { kind: 'server', language: 'typescript' } },
  { id: 'java', name: 'Eclipse JDT LS', group: 'servers', purpose: 'Java and Spring language server', source: { kind: 'server', language: 'java' } },
  { id: 'ls-cpp', name: 'clangd', group: 'servers', purpose: 'C, C++ and Objective-C', source: { kind: 'server', language: 'cpp' } },
  { id: 'ls-csharp', name: 'csharp-ls', group: 'servers', purpose: 'C# (needs the .NET SDK)', source: { kind: 'server', language: 'csharp' } },
  { id: 'ls-fsharp', name: 'fsautocomplete', group: 'servers', purpose: 'F# (needs the .NET SDK)', source: { kind: 'server', language: 'fsharp' } },
  { id: 'ls-php', name: 'intelephense', group: 'servers', purpose: 'PHP (npm)', source: { kind: 'server', language: 'php' } },
  { id: 'ls-lua', name: 'LuaLS', group: 'servers', purpose: 'Lua', source: { kind: 'server', language: 'lua' } },
  { id: 'ls-shellscript', name: 'bash-language-server', group: 'servers', purpose: 'Shell scripts (npm)', source: { kind: 'server', language: 'shellscript' } },
  { id: 'ls-perl', name: 'Perl Navigator', group: 'servers', purpose: 'Perl (npm)', source: { kind: 'server', language: 'perl' } },
  { id: 'ls-clojure', name: 'clojure-lsp', group: 'servers', purpose: 'Clojure', source: { kind: 'server', language: 'clojure' } },
  { id: 'ls-xml', name: 'LemMinX', group: 'servers', purpose: 'XML, XSD, WSDL', source: { kind: 'server', language: 'xml' } },
  { id: 'ls-dockerfile', name: 'docker-langserver', group: 'servers', purpose: 'Dockerfile (npm)', source: { kind: 'server', language: 'dockerfile' } },
  { id: 'ls-graphql', name: 'graphql-lsp', group: 'servers', purpose: 'GraphQL (npm)', source: { kind: 'server', language: 'graphql' } },
  { id: 'ls-sql', name: 'sql-language-server', group: 'servers', purpose: 'SQL (npm)', source: { kind: 'server', language: 'sql' } },
  { id: 'ls-powershell', name: 'PowerShell Editor Services', group: 'servers', purpose: 'PowerShell (needs pwsh or Windows PowerShell)', source: { kind: 'server', language: 'powershell' } },
  { id: 'ls-yaml', name: 'yaml-language-server', group: 'servers', purpose: 'YAML (npm)', source: { kind: 'server', language: 'yaml' } },
  { id: 'ls-toml', name: 'taplo', group: 'servers', purpose: 'TOML (npm)', source: { kind: 'server', language: 'toml' } },
  { id: 'ls-markdown', name: 'marksman', group: 'servers', purpose: 'Markdown', source: { kind: 'server', language: 'markdown' } },
  { id: 'ls-latex', name: 'texlab', group: 'servers', purpose: 'LaTeX', source: { kind: 'server', language: 'latex' } },
  { id: 'ls-cmake', name: 'neocmakelsp', group: 'servers', purpose: 'CMake', source: { kind: 'server', language: 'cmake' } },
  { id: 'ls-vue', name: 'Vue language server', group: 'servers', purpose: 'Vue (npm)', source: { kind: 'server', language: 'vue' } },
  { id: 'ls-svelte', name: 'svelteserver', group: 'servers', purpose: 'Svelte (npm)', source: { kind: 'server', language: 'svelte' } },
  { id: 'ls-proto', name: 'buf', group: 'servers', purpose: 'Protocol Buffers', source: { kind: 'server', language: 'proto' } },
  { id: 'golangci-lint', name: 'golangci-lint', group: 'diagnostics', purpose: 'Many linters in one run', source: { kind: 'module', binary: 'golangci-lint', module: 'github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest' } },
  { id: 'staticcheck', name: 'staticcheck', group: 'diagnostics', purpose: 'Fast, precise Go static analysis', source: { kind: 'module', binary: 'staticcheck', module: 'honnef.co/go/tools/cmd/staticcheck@latest' } },
  { id: 'dlv', name: 'Delve', group: 'debug', purpose: 'Go debugger (launch, attach, remote)', source: { kind: 'module', binary: 'dlv', module: 'github.com/go-delve/delve/cmd/dlv@latest' } },
  { id: 'govulncheck', name: 'govulncheck', group: 'security', purpose: 'Known vulnerabilities your code actually calls', source: { kind: 'module', binary: 'govulncheck', module: 'golang.org/x/vuln/cmd/govulncheck@latest' } },
  { id: 'strix', name: 'Strix', group: 'security', purpose: 'AI pentest agents (needs Docker)', source: { kind: 'strix' } },
  { id: 'goimports', name: 'goimports', group: 'tools', purpose: 'Fix imports and format files', source: { kind: 'module', binary: 'goimports', module: 'golang.org/x/tools/cmd/goimports@latest' } },
  { id: 'mockgen', name: 'mockgen', group: 'tools', purpose: 'Mocks from interfaces', source: { kind: 'module', binary: 'mockgen', module: 'go.uber.org/mock/mockgen@latest' } },
  { id: 'stringer', name: 'stringer', group: 'tools', purpose: 'String() for enum constants', source: { kind: 'module', binary: 'stringer', module: 'golang.org/x/tools/cmd/stringer@latest' } },
]

export interface InstallerStatus {
  available: boolean
  detail?: string
  /** adOmnia knows how to install it right now (a missing Go SDK or npm turns this off). */
  installable?: boolean
  error?: string
}

const failed = (error: unknown): InstallerStatus => ({ available: false, error: error instanceof Error ? error.message : String(error) })

/** One detection per tool, all in parallel; a failing probe only marks that tool, never the dialog. */
export async function detectInstallerStatus(sessionId: string): Promise<Record<string, InstallerStatus>> {
  const servers = await languageServers(sessionId).catch(() => [])
  const entries = await Promise.all(INSTALLER_TOOLS.map(async (tool): Promise<[string, InstallerStatus]> => {
    const { source } = tool
    try {
      if (source.kind === 'module') {
        const info = await detectGoIDEGoTool(sessionId, source.binary)
        return [tool.id, { available: info.available, detail: info.available ? info.path : undefined, installable: true }]
      }
      if (source.kind === 'server') {
        const info = servers.find((item) => item.language === source.language)
        return [tool.id, { available: !!info?.available, detail: info?.binary, installable: !!info?.installable, error: info?.available ? undefined : info?.error }]
      }
      const info = await strixInfo()
      return [tool.id, { available: info.installed, detail: info.version ?? info.binary, installable: true }]
    } catch (error) {
      return [tool.id, failed(error)]
    }
  }))
  return Object.fromEntries(entries)
}

/** The exact command the user confirms, in the same words the install will run. */
export async function installerCommand(sessionId: string, tool: InstallerTool): Promise<string> {
  const { source } = tool
  if (source.kind === 'module') return `go install ${source.module}`
  if (source.kind === 'server') return (await previewServerInstall(sessionId, source.language)).command
  return (await strixInstallPlan()).command
}

/**
 * Starts one installation; output goes to the Run console like every other tool install. Resolves with the
 * run id to follow (go tools), or null when the install tracks itself (language servers) or already ended (Strix).
 */
export async function startInstall(sessionId: string, tool: InstallerTool, onStrixDone: () => void): Promise<string | null> {
  const { source } = tool
  if (source.kind === 'server') {
    await useIdeLanguageServersStore.getState().install(sessionId, source.language)
    return null
  }
  if (source.kind === 'module') {
    const execution = await installGoIDEGoModule(sessionId, source.module)
    beginToolInstall(sessionId, `installer:${tool.id}`, `Installing ${tool.name}…`)
    return execution.id
  }
  beginToolInstall(sessionId, 'installer:strix', 'Installing Strix…')
  void followStrix(sessionId, (await strixInstall()).id, onStrixDone)
  return null
}

/** Strix installs outside the Run console: poll its run until it stops. */
async function followStrix(sessionId: string, runId: string, done: () => void): Promise<void> {
  let succeeded = false
  try {
    for (;;) {
      const run = await strixStatus(runId, 0)
      if (!isStrixActive(run.state)) { succeeded = run.state === 'finished'; break }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  } catch { succeeded = false }
  endToolInstall(sessionId, 'installer:strix', succeeded)
  done()
}

export function finishInstall(sessionId: string, toolId: string, succeeded: boolean): void {
  endToolInstall(sessionId, `installer:${toolId}`, succeeded)
}
