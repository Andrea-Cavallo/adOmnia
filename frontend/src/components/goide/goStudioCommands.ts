import { effectiveAltBindings, effectiveBinding, isRemapped } from './goStudioKeymap'

export type GoStudioCommandId =
  | 'file.openProject' | 'file.newProject' | 'file.clone' | 'go.goWork' | 'file.save' | 'file.saveAll' | 'file.closeEditor' | 'file.closeProject' | 'file.settings'
  | 'window.openInNewWindow' | 'window.moveBack'
  | 'file.closeOthers' | 'file.closeAll' | 'file.pinTab' | 'file.reopenClosed' | 'file.autoSave' | 'file.trimWhitespace'
  | 'edit.undo' | 'edit.redo' | 'edit.find' | 'edit.replace' | 'edit.gotoLine' | 'edit.toggleComment'
  | 'edit.duplicateLine' | 'edit.deleteLine' | 'edit.nextOccurrence' | 'edit.allOccurrences' | 'edit.moveLineUp' | 'edit.moveLineDown' | 'edit.columnSelection'
  | 'file.localHistory' | 'view.todo'
  | 'view.splitRight' | 'view.splitDown' | 'view.unsplit' | 'view.terminal'
  | 'view.zoomIn' | 'view.zoomOut' | 'view.zoomReset' | 'view.zenMode' | 'view.stickyScroll' | 'view.minimap' | 'view.fontLigatures' | 'view.previewTab' | 'view.lowResourceMode' | 'view.lowResourceOnBattery' | 'view.vimMode' | 'view.emacsMode'
  | 'view.quickOpen' | 'view.maximize' | 'view.maximizeEditor' | 'view.toggleProject' | 'view.toggleStructure' | 'view.toggleBottom' | 'view.toggleIgnored' | 'view.problems' | 'view.contextInspector'
  | 'nav.declaration' | 'nav.typeDeclaration' | 'nav.implementation' | 'nav.usages' | 'nav.fileStructure' | 'nav.symbol' | 'nav.findInFiles'
  | 'nav.recentLocations' | 'nav.lastEdit' | 'nav.gotoTest' | 'code.generate' | 'nav.callHierarchy' | 'nav.typeHierarchy' | 'nav.nextProblem' | 'nav.previousProblem'
  | 'nav.superMethod' | 'nav.back' | 'nav.forward' | 'nav.toggleBookmark' | 'nav.bookmarks'
  | 'nav.quickDefinition' | 'nav.showUsages' | 'nav.searchEverywhere' | 'code.quickDocumentation' | 'code.typeInfo' | 'code.semanticHighlighting' | 'code.inlayHints' | 'code.typeHints' | 'code.implementInterface'
  | 'code.refactorThis' | 'code.extractVariable' | 'code.extractConstant' | 'code.extractFunction' | 'code.inline' | 'code.moveToNewFile' | 'code.changeSignature'
  | 'code.completion' | 'code.parameterInfo' | 'code.quickFix' | 'code.rename' | 'code.reformat' | 'code.organizeImports'
  | 'code.formatOnSave' | 'code.importsOnSave' | 'code.gofumpt' | 'code.staticcheck' | 'code.vulncheck' | 'code.lint' | 'code.lintOnSave'
  | 'go.toolchains' | 'go.detect' | 'go.dependencies' | 'go.tidy' | 'go.trust'
  | 'go.updateAll' | 'go.updatePatch' | 'go.modDownload' | 'go.modVerify'
  | 'go.lspStart' | 'go.lspRestart' | 'go.lspStop' | 'go.lspInstall' | 'go.lspLog'
  | 'go.toolVet' | 'go.toolGenerate' | 'go.toolFix' | 'go.toolModWhy' | 'go.toolModGraph' | 'go.toolDoc'
  | 'go.installGolangci' | 'go.installStaticcheck' | 'go.toolPaths'
  | 'run.run' | 'run.build' | 'run.stop' | 'run.restart' | 'run.configure'
  | 'run.rerunFailedTests' | 'run.testChanged' | 'run.testCoverage' | 'run.testRace' | 'run.runRace' | 'run.benchPackage' | 'view.tests'
  | 'run.context' | 'run.buildPackage' | 'run.testPackage' | 'run.vetPackage' | 'run.buildAll' | 'run.testAll' | 'run.vetAll' | 'run.generateAll' | 'run.install'
  | 'debug.debug' | 'debug.toggleBreakpoint' | 'debug.resume' | 'debug.pause' | 'debug.stepOver' | 'debug.stepInto' | 'debug.stepOut'
  | 'debug.stop' | 'view.debug' | 'go.installDelve' | 'debug.attach' | 'debug.remote'
  | 'debug.viewBreakpoints' | 'debug.runToCursor' | 'debug.muteBreakpoints'
  | 'vcs.commit' | 'vcs.history' | 'vcs.lineHistory' | 'vcs.annotate' | 'vcs.resolveConflicts' | 'vcs.gitStudio'
  | 'tools.services' | 'tools.httpRequest' | 'tools.plugins' | 'tools.copilot' | 'tools.copilotChat' | 'tools.a0Chat' | 'tools.copilotCompletions' | 'tools.dependencyGraph' | 'tools.runtimeEnrichment'
  | 'help.shortcuts'

export type GoStudioMenuId = 'file' | 'edit' | 'view' | 'navigate' | 'code' | 'go' | 'run' | 'tools' | 'git' | 'help'

export interface GoStudioKeyBinding {
  key: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
}

export interface GoStudioCommand {
  id: GoStudioCommandId
  menu: GoStudioMenuId
  label: string
  binding?: GoStudioKeyBinding
  /** Tasti alternativi (es. F6 di Eclipse e F10 di VS Code per Step Over): funzionano ma i menu mostrano solo `binding`. */
  altBindings?: GoStudioKeyBinding[]
  /** Il binding è gestito da Monaco o da un listener dedicato (doppio Shift): mostrato nei menu, non intercettato globalmente. */
  editorOwned?: boolean
  /** Se il comando non è disponibile il tasto torna a Monaco (es. F8 = problema successivo fuori dal debug). */
  passThroughWhenUnavailable?: boolean
  separatorBefore?: boolean
}

export const GO_STUDIO_MENUS: ReadonlyArray<{ id: GoStudioMenuId; label: string }> = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'navigate', label: 'Navigate' },
  { id: 'code', label: 'Code' },
  { id: 'go', label: 'Go' },
  { id: 'run', label: 'Run' },
  { id: 'tools', label: 'Tools' },
  { id: 'git', label: 'Git' },
  { id: 'help', label: 'Help' },
]

export const GO_STUDIO_COMMANDS: ReadonlyArray<GoStudioCommand> = [
  { id: 'file.openProject', menu: 'file', label: 'Open Project…', binding: { key: 'o', mod: true } },
  { id: 'file.newProject', menu: 'file', label: 'New Go Project…' },
  { id: 'file.clone', menu: 'file', label: 'Clone Repository…' },
  { id: 'file.save', menu: 'file', label: 'Save', binding: { key: 's', mod: true }, separatorBefore: true },
  { id: 'file.saveAll', menu: 'file', label: 'Save All', binding: { key: 's', mod: true, shift: true } },
  { id: 'file.autoSave', menu: 'file', label: 'Save Files on Focus Change' },
  { id: 'file.trimWhitespace', menu: 'file', label: 'Trim Trailing Whitespace on Save' },
  { id: 'file.closeEditor', menu: 'file', label: 'Close Editor', binding: { key: 'w', mod: true }, separatorBefore: true },
  { id: 'file.closeOthers', menu: 'file', label: 'Close Other Tabs' },
  { id: 'file.closeAll', menu: 'file', label: 'Close All Tabs' },
  { id: 'file.pinTab', menu: 'file', label: 'Pin Tab' },
  { id: 'file.reopenClosed', menu: 'file', label: 'Reopen Closed Tab', binding: { key: 't', mod: true, shift: true } },
  { id: 'file.localHistory', menu: 'file', label: 'Local History…', separatorBefore: true },
  { id: 'file.closeProject', menu: 'file', label: 'Close Project' },
  { id: 'file.settings', menu: 'file', label: 'Settings…', binding: { key: 's', mod: true, alt: true }, separatorBefore: true },
  { id: 'window.openInNewWindow', menu: 'file', label: 'Open Project in New Window', separatorBefore: true },
  { id: 'window.moveBack', menu: 'file', label: 'Move Project Back to Main Window' },
  { id: 'edit.undo', menu: 'edit', label: 'Undo', binding: { key: 'z', mod: true }, editorOwned: true },
  { id: 'edit.redo', menu: 'edit', label: 'Redo', binding: { key: 'z', mod: true, shift: true }, editorOwned: true },
  { id: 'edit.find', menu: 'edit', label: 'Find', binding: { key: 'f', mod: true }, editorOwned: true, separatorBefore: true },
  { id: 'edit.replace', menu: 'edit', label: 'Replace', binding: { key: 'h', mod: true }, editorOwned: true },
  { id: 'edit.gotoLine', menu: 'edit', label: 'Go to Line…', binding: { key: 'g', mod: true }, editorOwned: true },
  { id: 'edit.toggleComment', menu: 'edit', label: 'Toggle Line Comment', binding: { key: '/', mod: true }, editorOwned: true, separatorBefore: true },
  { id: 'edit.duplicateLine', menu: 'edit', label: 'Duplicate Line or Selection', binding: { key: 'd', mod: true }, editorOwned: true },
  { id: 'edit.deleteLine', menu: 'edit', label: 'Delete Line', binding: { key: 'y', mod: true }, editorOwned: true },
  { id: 'edit.moveLineUp', menu: 'edit', label: 'Move Line Up', binding: { key: 'ArrowUp', mod: true, shift: true }, editorOwned: true },
  { id: 'edit.moveLineDown', menu: 'edit', label: 'Move Line Down', binding: { key: 'ArrowDown', mod: true, shift: true }, editorOwned: true },
  { id: 'edit.nextOccurrence', menu: 'edit', label: 'Add Caret at Next Occurrence', binding: { key: 'j', alt: true }, editorOwned: true, separatorBefore: true },
  { id: 'edit.allOccurrences', menu: 'edit', label: 'Select All Occurrences', binding: { key: 'j', mod: true, alt: true, shift: true }, editorOwned: true },
  { id: 'edit.columnSelection', menu: 'edit', label: 'Column Selection Mode', binding: { key: 'Insert', alt: true, shift: true }, editorOwned: true },
  { id: 'view.quickOpen', menu: 'view', label: 'Go to File…', binding: { key: 'p', mod: true } },
  { id: 'view.zoomIn', menu: 'view', label: 'Zoom In', binding: { key: '=', mod: true }, separatorBefore: true },
  { id: 'view.zoomOut', menu: 'view', label: 'Zoom Out', binding: { key: '-', mod: true } },
  { id: 'view.zoomReset', menu: 'view', label: 'Reset Zoom', binding: { key: '0', mod: true } },
  { id: 'view.stickyScroll', menu: 'view', label: 'Sticky Scopes', separatorBefore: true },
  { id: 'view.minimap', menu: 'view', label: 'Minimap' },
  { id: 'view.fontLigatures', menu: 'view', label: 'Font Ligatures' },
  { id: 'view.previewTab', menu: 'view', label: 'Preview Tab (single click in Project)' },
  { id: 'view.lowResourceMode', menu: 'view', label: 'Low-Resource Mode' },
  { id: 'view.lowResourceOnBattery', menu: 'view', label: 'Low-Resource Mode on Battery' },
  { id: 'view.vimMode', menu: 'view', label: 'Vim Mode', separatorBefore: true },
  { id: 'view.emacsMode', menu: 'view', label: 'Emacs Mode' },
  { id: 'view.zenMode', menu: 'view', label: 'Zen Mode', binding: { key: 'z', alt: true, shift: true }, separatorBefore: true },
  { id: 'view.maximizeEditor', menu: 'view', label: 'Maximize Editor (Hide All Tool Windows)', binding: { key: 'F12', mod: true, shift: true }, separatorBefore: true },
  { id: 'view.maximize', menu: 'view', label: 'Maximize Go Studio', binding: { key: 'F11', mod: true, shift: true } },
  { id: 'view.toggleProject', menu: 'view', label: 'Project Pane', binding: { key: '1', alt: true }, separatorBefore: true },
  { id: 'view.toggleStructure', menu: 'view', label: 'Project Overview Pane', binding: { key: '7', alt: true } },
  { id: 'view.toggleBottom', menu: 'view', label: 'Run / Problems Pane', binding: { key: '4', alt: true } },
  { id: 'view.problems', menu: 'view', label: 'Problems', binding: { key: '6', alt: true } },
  { id: 'view.contextInspector', menu: 'view', label: 'Context Propagation Inspector', binding: { key: '9', alt: true } },
  { id: 'view.terminal', menu: 'view', label: 'Terminal', binding: { key: 'F12', alt: true } },
  { id: 'view.tests', menu: 'view', label: 'Tests', binding: { key: '8', alt: true } },
  { id: 'view.todo', menu: 'view', label: 'TODO' },
  { id: 'view.debug', menu: 'view', label: 'Debug', binding: { key: '5', alt: true } },
  { id: 'view.splitRight', menu: 'view', label: 'Split Right', binding: { key: '\\', mod: true }, separatorBefore: true },
  { id: 'view.splitDown', menu: 'view', label: 'Split Down' },
  { id: 'view.unsplit', menu: 'view', label: 'Unsplit' },
  { id: 'view.toggleIgnored', menu: 'view', label: 'Show Ignored Folders', separatorBefore: true },
  { id: 'nav.searchEverywhere', menu: 'navigate', label: 'Search Everywhere', binding: { key: 'Shift Shift' }, editorOwned: true },
  { id: 'nav.declaration', menu: 'navigate', label: 'Declaration', binding: { key: 'b', mod: true }, editorOwned: true },
  { id: 'nav.typeDeclaration', menu: 'navigate', label: 'Type Declaration' },
  { id: 'nav.implementation', menu: 'navigate', label: 'Implementation(s)', binding: { key: 'b', mod: true, alt: true }, editorOwned: true },
  { id: 'nav.superMethod', menu: 'navigate', label: 'Super Method', binding: { key: 'u', mod: true }, editorOwned: true },
  { id: 'nav.usages', menu: 'navigate', label: 'Find Usages', binding: { key: 'F7', alt: true }, editorOwned: true },
  { id: 'nav.recentLocations', menu: 'navigate', label: 'Recent Locations…', binding: { key: 'e', mod: true, shift: true } },
  { id: 'nav.lastEdit', menu: 'navigate', label: 'Last Edit Location', binding: { key: 'Backspace', mod: true, shift: true } },
  { id: 'nav.gotoTest', menu: 'navigate', label: 'Test', binding: { key: 't', alt: true, shift: true }, editorOwned: true },
  { id: 'nav.callHierarchy', menu: 'navigate', label: 'Call Hierarchy', binding: { key: 'h', mod: true, alt: true }, editorOwned: true },
  { id: 'nav.typeHierarchy', menu: 'navigate', label: 'Type Hierarchy' },
  { id: 'nav.nextProblem', menu: 'navigate', label: 'Next Problem', binding: { key: 'F8' }, editorOwned: true, separatorBefore: true },
  { id: 'nav.previousProblem', menu: 'navigate', label: 'Previous Problem', binding: { key: 'F8', shift: true }, editorOwned: true },
  { id: 'nav.showUsages', menu: 'navigate', label: 'Show Usages', binding: { key: 'F7', mod: true, alt: true }, editorOwned: true },
  { id: 'nav.quickDefinition', menu: 'navigate', label: 'Quick Definition', binding: { key: 'i', mod: true, shift: true }, editorOwned: true },
  { id: 'nav.fileStructure', menu: 'navigate', label: 'File Structure', binding: { key: 'F12', mod: true }, editorOwned: true, separatorBefore: true },
  { id: 'nav.back', menu: 'navigate', label: 'Back', binding: { key: 'ArrowLeft', mod: true, alt: true }, separatorBefore: true },
  { id: 'nav.forward', menu: 'navigate', label: 'Forward', binding: { key: 'ArrowRight', mod: true, alt: true } },
  { id: 'nav.toggleBookmark', menu: 'navigate', label: 'Toggle Bookmark', binding: { key: 'F11' } },
  { id: 'nav.bookmarks', menu: 'navigate', label: 'Bookmarks…', binding: { key: 'F11', shift: true } },
  { id: 'nav.symbol', menu: 'navigate', label: 'Symbol in Workspace…', binding: { key: 't', mod: true } },
  { id: 'nav.findInFiles', menu: 'navigate', label: 'Find in Files…', binding: { key: 'f', mod: true, shift: true }, separatorBefore: true },
  { id: 'code.completion', menu: 'code', label: 'Code Completion', binding: { key: 'Space', mod: true }, editorOwned: true },
  { id: 'code.parameterInfo', menu: 'code', label: 'Parameter Info', binding: { key: 'Space', mod: true, shift: true }, editorOwned: true },
  { id: 'code.quickDocumentation', menu: 'code', label: 'Quick Documentation', binding: { key: 'q', mod: true }, editorOwned: true },
  { id: 'code.typeInfo', menu: 'code', label: 'Type Info', binding: { key: 'p', mod: true, shift: true }, editorOwned: true },
  { id: 'code.quickFix', menu: 'code', label: 'Show Context Actions', binding: { key: 'Enter', alt: true }, editorOwned: true, separatorBefore: true },
  { id: 'code.implementInterface', menu: 'code', label: 'Implement Interface…', binding: { key: 'i', mod: true }, editorOwned: true },
  { id: 'code.generate', menu: 'code', label: 'Generate…', binding: { key: 'Insert', alt: true }, editorOwned: true, separatorBefore: true },
  { id: 'code.rename', menu: 'code', label: 'Rename…', binding: { key: 'F6', shift: true }, editorOwned: true },
  { id: 'code.refactorThis', menu: 'code', label: 'Refactor This…', binding: { key: 't', mod: true, alt: true, shift: true }, editorOwned: true, separatorBefore: true },
  { id: 'code.extractVariable', menu: 'code', label: 'Extract Variable', binding: { key: 'v', mod: true, alt: true }, editorOwned: true },
  { id: 'code.extractConstant', menu: 'code', label: 'Extract Constant', binding: { key: 'c', mod: true, alt: true }, editorOwned: true },
  { id: 'code.extractFunction', menu: 'code', label: 'Extract Function/Method', binding: { key: 'm', mod: true, alt: true }, editorOwned: true },
  { id: 'code.inline', menu: 'code', label: 'Inline', binding: { key: 'n', mod: true, alt: true }, editorOwned: true },
  { id: 'code.moveToNewFile', menu: 'code', label: 'Move to New File', binding: { key: 'F6' }, editorOwned: true },
  { id: 'code.changeSignature', menu: 'code', label: 'Change Signature…', binding: { key: 'F6', mod: true }, editorOwned: true },
  { id: 'code.reformat', menu: 'code', label: 'Reformat Code', binding: { key: 'l', mod: true, alt: true }, editorOwned: true, separatorBefore: true },
  { id: 'code.organizeImports', menu: 'code', label: 'Optimize Imports', binding: { key: 'o', mod: true, alt: true }, editorOwned: true },
  { id: 'code.lint', menu: 'code', label: 'Run Linter', binding: { key: 'l', mod: true, alt: true, shift: true }, separatorBefore: true },
  { id: 'code.formatOnSave', menu: 'code', label: 'Reformat on Save', separatorBefore: true },
  { id: 'code.importsOnSave', menu: 'code', label: 'Optimize Imports on Save' },
  { id: 'code.lintOnSave', menu: 'code', label: 'Run Linter on Save' },
  { id: 'code.semanticHighlighting', menu: 'code', label: 'Semantic Highlighting' },
  { id: 'code.inlayHints', menu: 'code', label: 'Inlay Hints' },
  { id: 'code.typeHints', menu: 'code', label: 'Type Hints (:=, range, literals, constants)' },
  { id: 'code.gofumpt', menu: 'code', label: 'Use gofumpt Style' },
  { id: 'code.staticcheck', menu: 'code', label: 'Staticcheck Analyses' },
  { id: 'code.vulncheck', menu: 'code', label: 'Vulnerability Diagnostics (vuln.go.dev)' },
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
  { id: 'run.run', menu: 'run', label: 'Run', binding: { key: 'F5', mod: true } },
  { id: 'debug.debug', menu: 'run', label: 'Debug', binding: { key: 'F9', shift: true } },
  { id: 'debug.attach', menu: 'run', label: 'Attach to Process…' },
  { id: 'debug.remote', menu: 'run', label: 'Connect to Remote Delve…' },
  { id: 'run.build', menu: 'run', label: 'Build', binding: { key: 'b', mod: true, shift: true } },
  { id: 'run.buildPackage', menu: 'run', label: 'Build Current Package', binding: { key: 'F9', mod: true }, separatorBefore: true },
  { id: 'run.context', menu: 'run', label: 'Run Current Context (test, main or package)', binding: { key: 'F10', mod: true, shift: true } },
  { id: 'run.testPackage', menu: 'run', label: 'Test Current Package' },
  { id: 'run.testChanged', menu: 'run', label: 'Test Changed Packages' },
  { id: 'run.benchPackage', menu: 'run', label: 'Run Current Package Benchmarks' },
  { id: 'run.vetPackage', menu: 'run', label: 'Vet Current Package' },
  { id: 'run.testCoverage', menu: 'run', label: 'Test Current Package with Coverage' },
  { id: 'run.testRace', menu: 'run', label: 'Test Current Package with Race Detector' },
  { id: 'run.runRace', menu: 'run', label: 'Run with Race Detector' },
  { id: 'run.rerunFailedTests', menu: 'run', label: 'Rerun Failed Tests', binding: { key: 'F10', mod: true, shift: true, alt: true } },
  { id: 'run.buildAll', menu: 'run', label: 'Build All (go build ./...)', binding: { key: 'F9', mod: true, shift: true }, separatorBefore: true },
  { id: 'run.testAll', menu: 'run', label: 'Test All (go test ./...)', binding: { key: 'F10', mod: true, alt: true } },
  { id: 'run.vetAll', menu: 'run', label: 'Vet All (go vet ./...)' },
  { id: 'run.generateAll', menu: 'run', label: 'Generate (go generate ./...)' },
  { id: 'run.install', menu: 'run', label: 'Install (go install)' },
  { id: 'run.stop', menu: 'run', label: 'Stop', binding: { key: 'F5', shift: true }, separatorBefore: true },
  { id: 'run.restart', menu: 'run', label: 'Restart', binding: { key: 'F5', mod: true, shift: true } },
  { id: 'debug.toggleBreakpoint', menu: 'run', label: 'Toggle Line Breakpoint', binding: { key: 'F8', mod: true }, separatorBefore: true },
  { id: 'debug.viewBreakpoints', menu: 'run', label: 'View Breakpoints…', binding: { key: 'F8', mod: true, shift: true } },
  { id: 'debug.muteBreakpoints', menu: 'run', label: 'Mute / Unmute Breakpoints' },
  { id: 'debug.resume', menu: 'run', label: 'Resume Program', binding: { key: 'F9' }, altBindings: [{ key: 'F5' }], passThroughWhenUnavailable: true },
  { id: 'debug.pause', menu: 'run', label: 'Pause Program', passThroughWhenUnavailable: true },
  { id: 'debug.stepOver', menu: 'run', label: 'Step Over', binding: { key: 'F8' }, altBindings: [{ key: 'F6' }, { key: 'F10' }], passThroughWhenUnavailable: true },
  { id: 'debug.stepInto', menu: 'run', label: 'Step Into', binding: { key: 'F7' }, passThroughWhenUnavailable: true },
  { id: 'debug.stepOut', menu: 'run', label: 'Step Out', binding: { key: 'F8', shift: true }, passThroughWhenUnavailable: true },
  { id: 'debug.runToCursor', menu: 'run', label: 'Run to Cursor', binding: { key: 'F9', alt: true }, passThroughWhenUnavailable: true },
  { id: 'debug.stop', menu: 'run', label: 'Stop Debugging', binding: { key: 'F2', mod: true }, passThroughWhenUnavailable: true },
  { id: 'run.configure', menu: 'run', label: 'Edit Run Configuration…', separatorBefore: true },
  { id: 'tools.services', menu: 'tools', label: 'Project Services: Docker Lab, Database, Broker…' },
  { id: 'tools.httpRequest', menu: 'tools', label: 'Open HTTP Route in API Client' },
  { id: 'tools.plugins', menu: 'tools', label: 'Plugins Listening to Go Studio Events', separatorBefore: true },
  { id: 'tools.copilot', menu: 'tools', label: 'GitHub Copilot…', separatorBefore: true },
  { id: 'tools.copilotChat', menu: 'tools', label: 'Open Copilot Chat' },
  { id: 'tools.a0Chat', menu: 'tools', label: 'Open a0' },
  { id: 'tools.copilotCompletions', menu: 'tools', label: 'Toggle Copilot Inline Completions' },
  { id: 'tools.dependencyGraph', menu: 'tools', label: 'Dependency Graph…' },
  { id: 'tools.runtimeEnrichment', menu: 'tools', label: 'Runtime Enrichment…' },
  { id: 'vcs.commit', menu: 'git', label: 'Commit…', binding: { key: 'k', mod: true } },
  { id: 'vcs.history', menu: 'git', label: 'Show File History…' },
  { id: 'vcs.lineHistory', menu: 'git', label: 'Show History for Selection…' },
  { id: 'vcs.annotate', menu: 'git', label: 'Annotate with Git Blame' },
  { id: 'vcs.resolveConflicts', menu: 'git', label: 'Resolve Conflicts…' },
  { id: 'vcs.gitStudio', menu: 'git', label: 'Push, Pull, Conflicts and Rebase in Git Studio', separatorBefore: true },
  { id: 'help.shortcuts', menu: 'help', label: 'Keyboard Shortcuts' },
]

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Rende un binding leggibile e coerente con la piattaforma corrente. */
export function formatBinding(binding: GoStudioKeyBinding | undefined, mac = IS_MAC): string {
  if (!binding) return ''
  const parts: string[] = []
  if (binding.mod) parts.push(mac ? '⌘' : 'Ctrl')
  if (binding.alt) parts.push(mac ? '⌥' : 'Alt')
  if (binding.shift) parts.push(mac ? '⇧' : 'Shift')
  parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  return parts.join(mac ? '' : '+')
}

interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** Zoom: "=" e "+" (anche con Shift o dal tastierino) e "-" funzionano con layout US e italiano. */
const ZOOM_KEYS: Record<string, { keys: string[]; codes: string[] }> = {
  '=': { keys: ['=', '+'], codes: ['Equal', 'NumpadAdd'] },
  '-': { keys: ['-', '_'], codes: ['Minus', 'NumpadSubtract'] },
}

function keyMatches(binding: GoStudioKeyBinding, event: KeyLike): boolean {
  const mod = event.ctrlKey || event.metaKey
  const zoom = ZOOM_KEYS[binding.key]
  if (zoom) return !!binding.mod === mod && !event.altKey && (zoom.keys.includes(event.key) || zoom.codes.includes(event.code ?? ''))
  if (!!binding.mod !== mod || !!binding.shift !== event.shiftKey || !!binding.alt !== event.altKey) return false
  if (binding.key.length > 1) return event.key === binding.key
  if (/^[0-9]$/.test(binding.key) && event.code === `Digit${binding.key}`) return true
  return event.key.toLowerCase() === binding.key
}

/**
 * Comandi Go Studio intercettabili per un evento tastiera, nell'ordine del registro, con la keymap corrente.
 * I comandi gestiti da Monaco si intercettano solo se l'utente o la keymap ne hanno cambiato il tasto.
 */
export function commandsForKey(event: KeyLike): GoStudioCommand[] {
  return GO_STUDIO_COMMANDS.filter((command) => {
    if (command.editorOwned && !isRemapped(command)) return false
    return [effectiveBinding(command), ...effectiveAltBindings(command)].some((binding) => !!binding && keyMatches(binding, event))
  })
}

export function commandForKey(event: KeyLike): GoStudioCommand | null {
  return commandsForKey(event)[0] ?? null
}

/** Il tasto predefinito di un comando dell'editor che è stato rimappato: non deve più eseguire l'azione vecchia. */
export function isStaleEditorKey(event: KeyLike): boolean {
  return GO_STUDIO_COMMANDS.some((command) => command.editorOwned && !!command.binding && isRemapped(command) && keyMatches(command.binding, event))
}

/** Scorciatoia mostrata in menu, palette e dialog: quella effettiva della keymap corrente. */
export function commandShortcut(command: GoStudioCommand): string {
  return command.id === 'nav.searchEverywhere' ? formatBinding(command.binding) : formatBinding(effectiveBinding(command))
}

export interface GoStudioCommandContext {
  hasSession: boolean
  documentCount: number
  hasClosedDocuments: boolean
  split: boolean
  lspState: 'stopped' | 'starting' | 'ready' | 'crashed' | 'unavailable'
  goplsAvailable: boolean
  formatOnSave: boolean
  importsOnSave: boolean
  gofumpt: boolean
  staticcheck: boolean
  vulncheck?: boolean
  lintOnSave: boolean
  linterAvailable: boolean
  linting: boolean
  authorized: boolean
  toolchainReady: boolean
  running: boolean
  restartable: boolean
  hasEditor: boolean
  activeDocumentDirty: boolean
  sessionDirty: boolean
  structureOpen: boolean
  bottomOpen: boolean
  showIgnored: boolean
  maximized: boolean
  projectOpen: boolean
  semanticHighlighting: boolean
  inlayHints: boolean
  semanticTokensSupported: boolean
  inlayHintsSupported: boolean
  /** Stato del debug attivo della sessione: 'none' se non c'è un debugger vivo. */
  debugState: 'none' | 'starting' | 'running' | 'stopped'
  /** Il progetto è in un repository Git. */
  vcsAvailable: boolean
  vcsChanges: number
  /** File in conflitto (merge, rebase, cherry-pick in corso). */
  vcsConflicts: number
  canGoBack: boolean
  canGoForward: boolean
  bookmarkCount: number
  /** Preferenze dell'editor mostrate con spunta nei menu. */
  editorPrefs?: { resourceMode?: 'normal' | 'low' | 'auto'; editorMode?: 'default' | 'vim' | 'emacs'; previewTab?: boolean; stickyScroll: boolean; minimap: boolean; fontLigatures: boolean; typeHints: boolean; autoSave: boolean; trimTrailingWhitespace: boolean }
  zen?: boolean
  /** Finestra Go Studio separata: mostra un solo progetto e non ha rail né pannelli adOmnia. */
  detached?: boolean
  /** Il progetto attivo è modificabile in un'altra finestra: i suoi buffer vivono là. */
  ownedElsewhere?: boolean
}

const NO_PROJECT = 'Open a Go project first'
const NOT_TRUSTED = 'Trust this project to allow local Go tools'
const LSP_NOT_READY = 'Waiting for gopls (Go → Start Language Server)'

function semanticAvailability(context: GoStudioCommandContext): true | string {
  if (!context.hasEditor) return 'Open a Go file first'
  return context.lspState === 'ready' ? true : LSP_NOT_READY
}

function runAvailability(context: GoStudioCommandContext): true | string {
  if (!context.hasSession) return NO_PROJECT
  if (!context.authorized) return NOT_TRUSTED
  return context.toolchainReady ? true : 'Detect or install a Go SDK first'
}

/** Calcola se un comando è eseguibile nello stato corrente e, se no, perché. */
const MAIN_WINDOW_ONLY = new Set<GoStudioCommandId>(['file.openProject', 'file.newProject', 'tools.services', 'tools.httpRequest', 'tools.plugins', 'vcs.gitStudio'])

function windowAvailability(id: GoStudioCommandId, context: GoStudioCommandContext): true | string | null {
  if (context.detached && MAIN_WINDOW_ONLY.has(id)) return 'Available in the main adOmnia window'
  switch (id) {
    case 'window.openInNewWindow':
      if (context.detached) return 'This window already shows a single project'
      if (!context.hasSession) return NO_PROJECT
      return context.sessionDirty ? 'Save or discard the open files first: unsaved changes stay in this window' : true
    case 'window.moveBack': return context.detached ? true : 'The project is already in the main window'
    case 'file.closeProject':
      if (context.detached) return 'Move the project back to the main window to close it'
      return context.ownedElsewhere ? 'The project is open in a separate window: move it back first' : null
  }
  return null
}

export function commandAvailability(id: GoStudioCommandId, context: GoStudioCommandContext): true | string {
  const windowed = windowAvailability(id, context)
  if (windowed !== null) return windowed
  if (id === 'view.maximize') return context.detached ? 'Already a separate window' : true
  if (id === 'view.zenMode') return context.detached ? 'Available in the main window' : true
  if (id === 'file.openProject' || id === 'file.newProject' || id === 'file.clone' || id === 'help.shortcuts') return true
  if (!context.hasSession) return NO_PROJECT
  if (id.startsWith('edit.')) return context.hasEditor ? true : 'Open a file first'
  switch (id) {
    case 'nav.back': return context.canGoBack ? true : 'No earlier location'
    case 'nav.forward': return context.canGoForward ? true : 'No later location'
    case 'nav.toggleBookmark': return context.hasEditor ? true : 'Open a file first'
    case 'nav.bookmarks': return context.bookmarkCount > 0 ? true : 'No bookmarks yet (F11 adds one)'
  }
  if (id.startsWith('nav.') && id !== 'nav.symbol' && id !== 'nav.findInFiles') return semanticAvailability(context)
  if (id === 'code.lint') {
    if (!context.authorized) return NOT_TRUSTED
    return context.linterAvailable ? true : 'Install golangci-lint or staticcheck (Go menu)'
  }
  if (id === 'code.typeHints') return context.inlayHints ? true : 'Turn on Inlay Hints first'
  if (id === 'code.semanticHighlighting' || id === 'code.inlayHints') return context.lspState === 'ready' && !context[id === 'code.inlayHints' ? 'inlayHintsSupported' : 'semanticTokensSupported'] ? 'The running gopls does not provide this feature' : true
  if (id.startsWith('code.') && ['code.formatOnSave', 'code.importsOnSave', 'code.gofumpt', 'code.staticcheck', 'code.vulncheck', 'code.lintOnSave'].indexOf(id) < 0) return semanticAvailability(context)
  switch (id) {
    case 'file.save': return context.activeDocumentDirty ? true : 'No unsaved changes in this file'
    case 'file.saveAll': return context.sessionDirty ? true : 'No unsaved changes'
    case 'file.closeEditor':
    case 'file.pinTab':
    case 'view.splitRight':
    case 'view.splitDown': return context.hasEditor ? true : 'No file is open'
    case 'file.closeOthers': return context.documentCount > 1 ? true : 'Only one tab is open'
    case 'file.closeAll': return context.documentCount > 0 ? true : 'No tabs are open'
    case 'file.reopenClosed': return context.hasClosedDocuments ? true : 'No recently closed tabs'
    case 'file.localHistory': return context.hasEditor ? true : 'Open a file first'
    case 'tools.httpRequest': return context.hasEditor ? true : 'Open a Go file with route registrations first'
    case 'vcs.commit': return !context.vcsAvailable ? 'The project is not in a Git repository' : context.vcsChanges > 0 ? true : 'No local changes to commit'
    case 'vcs.resolveConflicts': return !context.vcsAvailable ? 'The project is not in a Git repository' : context.vcsConflicts > 0 ? true : 'No conflicted files'
    case 'vcs.history':
    case 'vcs.lineHistory':
    case 'vcs.annotate': return !context.vcsAvailable ? 'The project is not in a Git repository' : context.hasEditor ? true : 'Open a file first'
    case 'view.unsplit': return context.split ? true : 'The editor is not split'
    case 'go.toolchains':
    case 'go.detect': return context.authorized ? true : NOT_TRUSTED
    case 'go.tidy': return context.running ? 'Wait for the active process to finish' : runAvailability(context)
    case 'run.run':
    case 'run.build':
    case 'run.buildPackage':
    case 'run.context':
    case 'run.testPackage':
    case 'run.testChanged':
    case 'run.benchPackage':
    case 'run.vetPackage':
    case 'run.buildAll':
    case 'run.testAll':
    case 'run.vetAll':
    case 'run.generateAll':
    case 'run.install':
    case 'run.testCoverage':
    case 'run.testRace':
    case 'run.runRace':
    case 'run.rerunFailedTests':
    case 'go.modVerify':
    case 'go.toolVet':
    case 'go.toolGenerate':
    case 'go.toolFix':
    case 'go.toolModWhy':
    case 'go.toolModGraph':
    case 'go.toolDoc': return runAvailability(context)
    case 'go.updateAll':
    case 'go.updatePatch':
    case 'go.modDownload': return context.running ? 'Wait for the active process to finish' : runAvailability(context)
    case 'run.stop': return context.running ? true : 'Nothing is running'
    case 'debug.debug':
    case 'debug.attach':
    case 'go.installDelve': return runAvailability(context)
    case 'debug.remote': return context.authorized ? true : NOT_TRUSTED
    case 'debug.toggleBreakpoint': return context.hasEditor ? true : 'Open a Go file first'
    case 'debug.viewBreakpoints':
    case 'debug.muteBreakpoints': return true
    case 'debug.runToCursor': return context.debugState !== 'stopped' ? 'The debugger is not paused' : context.hasEditor ? true : 'Open a Go file first'
    case 'debug.resume':
    case 'debug.stepOver':
    case 'debug.stepInto':
    case 'debug.stepOut': return context.debugState === 'stopped' ? true : 'The debugger is not paused'
    case 'debug.pause': return context.debugState === 'running' ? true : 'The program is not running under the debugger'
    case 'debug.stop': return context.debugState === 'none' ? 'No debug session is active' : true
    case 'nav.symbol': return context.lspState === 'ready' ? true : LSP_NOT_READY
    case 'go.lspStart':
      if (!context.authorized) return NOT_TRUSTED
      if (!context.goplsAvailable) return 'Install gopls first (Go → Install gopls…)'
      return context.lspState === 'ready' || context.lspState === 'starting' ? 'gopls is already running' : true
    case 'go.lspRestart': return context.authorized && context.goplsAvailable ? true : NOT_TRUSTED
    case 'go.lspStop': return context.lspState === 'ready' || context.lspState === 'starting' ? true : 'gopls is not running'
    case 'go.lspInstall':
    case 'go.installGolangci':
    case 'go.installStaticcheck': return runAvailability(context)
    case 'run.restart': return context.restartable ? runAvailability(context) : 'Run or build first'
    default: return true
  }
}

/** Indica lo stato attivo dei comandi toggle mostrati con spunta nei menu. */
export function commandChecked(id: GoStudioCommandId, context: GoStudioCommandContext): boolean {
  switch (id) {
    case 'view.maximize': return context.maximized
    case 'view.zenMode': return !!context.zen
    case 'view.stickyScroll': return !!context.editorPrefs?.stickyScroll
    case 'view.minimap': return !!context.editorPrefs?.minimap
    case 'view.previewTab': return !!context.editorPrefs?.previewTab
    case 'view.lowResourceMode': return context.editorPrefs?.resourceMode === 'low'
    case 'view.lowResourceOnBattery': return context.editorPrefs?.resourceMode === 'auto'
    case 'view.vimMode': return context.editorPrefs?.editorMode === 'vim'
    case 'view.emacsMode': return context.editorPrefs?.editorMode === 'emacs'
    case 'view.fontLigatures': return !!context.editorPrefs?.fontLigatures
    case 'code.typeHints': return !!context.editorPrefs?.typeHints && context.inlayHints
    case 'file.autoSave': return !!context.editorPrefs?.autoSave
    case 'file.trimWhitespace': return !!context.editorPrefs?.trimTrailingWhitespace
    case 'view.maximizeEditor': return !context.projectOpen && !context.structureOpen && !context.bottomOpen
    case 'view.toggleProject': return context.projectOpen
    case 'view.toggleStructure': return context.structureOpen
    case 'view.toggleBottom': return context.bottomOpen
    case 'view.toggleIgnored': return context.showIgnored
    case 'go.trust': return context.authorized
    case 'code.formatOnSave': return context.formatOnSave
    case 'code.importsOnSave': return context.importsOnSave
    case 'code.gofumpt': return context.gofumpt
    case 'code.staticcheck': return context.staticcheck
    case 'code.vulncheck': return !!context.vulncheck
    case 'code.lintOnSave': return context.lintOnSave
    case 'code.semanticHighlighting': return context.semanticHighlighting
    case 'code.inlayHints': return context.inlayHints
    default: return false
  }
}
