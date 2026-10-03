import type { GoStudioCommand } from '@/components/goide/goStudioCommands'
import { GO_LANGUAGE_ID } from '.'

export type GoLanguageCommandId =
  | 'go.toolchains' | 'go.detect' | 'go.dependencies' | 'go.goWork' | 'go.tidy' | 'go.trust'
  | 'go.updateAll' | 'go.updatePatch' | 'go.modDownload' | 'go.modVerify'
  | 'go.lspStart' | 'go.lspRestart' | 'go.lspStop' | 'go.lspInstall' | 'go.lspLog'
  | 'go.toolVet' | 'go.toolGenerate' | 'go.toolFix' | 'go.toolModWhy' | 'go.toolModGraph' | 'go.toolDoc'
  | 'go.installGolangci' | 'go.installStaticcheck' | 'go.installDelve' | 'go.toolPaths'

const requires = { language: GO_LANGUAGE_ID }

/** Comandi del menu Go: contribuiti dall'adapter, disponibili solo se il backend registra Go. */
export const GO_LANGUAGE_COMMANDS: ReadonlyArray<GoStudioCommand> = ([
  { id: 'go.toolchains', menu: 'go', label: 'Go SDKs & Toolchains…' },
  { id: 'go.detect', menu: 'go', label: 'Detect Go SDK' },
  { id: 'go.dependencies', menu: 'go', label: 'Module Dependencies…', separatorBefore: true },
  { id: 'go.goWork', menu: 'go', label: 'Go Workspace (go.work)…' },
  { id: 'go.tidy', menu: 'go', label: 'go mod tidy…' },
  { id: 'go.updateAll', menu: 'go', label: 'Update All Dependencies…' },
  { id: 'go.updatePatch', menu: 'go', label: 'Update Patch Versions…' },
  { id: 'go.modDownload', menu: 'go', label: 'Download Modules…' },
  { id: 'go.modVerify', menu: 'go', label: 'Verify Modules' },
  { id: 'go.toolVet', menu: 'go', label: 'Go Tools: go vet…', separatorBefore: true },
  { id: 'go.toolGenerate', menu: 'go', label: 'Go Tools: go generate…' },
  { id: 'go.toolFix', menu: 'go', label: 'Go Tools: go fix…' },
  { id: 'go.toolModWhy', menu: 'go', label: 'Go Tools: go mod why…' },
  { id: 'go.toolModGraph', menu: 'go', label: 'Go Tools: go mod graph…' },
  { id: 'go.toolDoc', menu: 'go', label: 'Go Tools: go doc…' },
  { id: 'go.trust', menu: 'go', label: 'Trust Project Tools', separatorBefore: true },
  { id: 'go.lspStart', menu: 'go', label: 'Start Language Server (gopls)', separatorBefore: true },
  { id: 'go.lspRestart', menu: 'go', label: 'Restart Language Server' },
  { id: 'go.lspStop', menu: 'go', label: 'Stop Language Server' },
  { id: 'go.lspInstall', menu: 'go', label: 'Install gopls…' },
  { id: 'go.lspLog', menu: 'go', label: 'Language Server Log…' },
  { id: 'go.installGolangci', menu: 'go', label: 'Install golangci-lint…', separatorBefore: true },
  { id: 'go.installStaticcheck', menu: 'go', label: 'Install staticcheck…' },
  { id: 'go.installDelve', menu: 'go', label: 'Install Delve (debugger)…' },
  { id: 'go.toolPaths', menu: 'go', label: 'Tool Paths (gopls, linter, dlv)…' },
] satisfies ReadonlyArray<Omit<GoStudioCommand, 'requires'>>).map((command) => ({ ...command, requires }))
