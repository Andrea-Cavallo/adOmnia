import type { IdeLanguageContribution } from '../../languages'
import { NATIVE_DEBUG_LANGUAGES, nativeDebugTargetOf } from '@/lib/code-studio/nativeDebug'

const declared = (id: string, name: string, icon: IdeLanguageContribution['icon'], editorLanguages: string[], languageServer: string): IdeLanguageContribution => ({
  id, name, icon, editorLanguages, languageServer,
  // Generic LSP features: each one starts only if the server announces it.
  heavyFeatures: false, semanticTokens: true, inlayHints: true, providedServer: true,
})

/**
 * Languages served only by a language server on PATH (`internal/languages/declared`): editor
 * support without Run/Debug/Test. Ids match the backend table; servers are installed by the user.
 */
const ROWS: readonly IdeLanguageContribution[] = [
  declared('cpp', 'C/C++', 'cplusplus', ['c', 'cpp'], 'clangd'),
  declared('objective-c', 'Objective-C', 'c', ['objective-c'], 'clangd'),
  declared('csharp', 'C#', 'dotnet', ['csharp'], 'csharp-ls'),
  declared('fsharp', 'F#', 'fsharp', ['fsharp'], 'fsautocomplete'),
  declared('php', 'PHP', 'php', ['php'], 'intelephense'),
  declared('ruby', 'Ruby', 'ruby', ['ruby'], 'ruby-lsp'),
  declared('lua', 'Lua', 'lua', ['lua'], 'lua-language-server'),
  declared('kotlin', 'Kotlin', 'kotlin', ['kotlin'], 'kotlin-lsp'),
  declared('swift', 'Swift', 'swift', ['swift'], 'sourcekit-lsp'),
  declared('dart', 'Dart', 'dart', ['dart'], 'dart'),
  declared('shellscript', 'Shell Script', 'gnubash', ['shell'], 'bash-language-server'),
  declared('scala', 'Scala', 'scala', ['scala'], 'metals'),
  declared('elixir', 'Elixir', 'elixir', ['elixir'], 'elixir-ls'),
  declared('haskell', 'Haskell', 'haskell', ['haskell'], 'haskell-language-server'),
  declared('zig', 'Zig', 'zig', ['zig'], 'zls'),
  declared('perl', 'Perl', 'perl', ['perl'], 'perlnavigator'),
  declared('r', 'R', 'r', ['r'], 'R languageserver'),
  declared('julia', 'Julia', 'julia', ['julia'], 'LanguageServer.jl'),
  declared('clojure', 'Clojure', 'clojure', ['clojure'], 'clojure-lsp'),
  declared('xml', 'XML', 'xml', ['xml'], 'lemminx'),
  declared('dockerfile', 'Dockerfile', 'docker', ['dockerfile'], 'docker-langserver'),
  declared('terraform', 'Terraform', 'terraform', ['hcl'], 'terraform-ls'),
  declared('graphql', 'GraphQL', 'graphql', ['graphql'], 'graphql-lsp'),
]

/**
 * Native languages run and debug a built executable (`executable` kind, CodeLLDB like Rust);
 * the build itself is a Before launch task (make, cmake --build, zig build, swift build).
 */
export const DECLARED_LANGUAGES: readonly IdeLanguageContribution[] = ROWS.map((language) => NATIVE_DEBUG_LANGUAGES.includes(language.id)
  ? { ...language, runTemplates: [{ language: language.id, kind: 'executable', label: `${language.name} executable`, group: language.name }], canDebugRun: (config) => nativeDebugTargetOf(config) !== null }
  : language)
