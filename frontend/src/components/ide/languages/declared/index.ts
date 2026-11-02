import type { IdeLanguageContribution } from '../../languages'
import { DOTNET_LANGUAGES, NATIVE_DEBUG_LANGUAGES, SCRIPT_DEBUG_LANGUAGES, nativeDebugTargetOf } from '@/lib/code-studio/nativeDebug'

const declared = (id: string, name: string, icon: IdeLanguageContribution['icon'], editorLanguages: string[], languageServer: string): IdeLanguageContribution => ({
  id, name, icon, editorLanguages, languageServer,
  // Generic LSP features: each one starts only if the server announces it.
  heavyFeatures: false, semanticTokens: true, inlayHints: true, providedServer: true,
})

/**
 * Languages served by a language server on PATH (`internal/languages/declared`): editor support,
 * project units from their manifest, Run for native executables, scripts and .NET projects, Debug for
 * native executables, PHP/Dart scripts and .NET projects, Test for the rows whose runner writes a JUnit or TRX report. Ids match the backend table; servers are installed by the user.
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
  declared('sql', 'SQL', 'sqlite', ['sql'], 'sql-language-server'),
  // Simple Icons carries no PowerShell mark: adOmnia draws the prompt glyph itself.
  declared('powershell', 'PowerShell', 'powershell', ['powershell'], 'powershell-editor-services'),
  declared('yaml', 'YAML', 'yaml', ['yaml'], 'yaml-language-server'),
  declared('toml', 'TOML', 'toml', ['toml'], 'taplo'),
  declared('markdown', 'Markdown', 'markdown', ['markdown'], 'marksman'),
  declared('nix', 'Nix', 'nixos', ['nix'], 'nil'),
  declared('latex', 'LaTeX', 'latex', ['latex'], 'texlab'),
  declared('ocaml', 'OCaml', 'ocaml', ['ocaml'], 'ocamllsp'),
  declared('erlang', 'Erlang', 'erlang', ['erlang'], 'elp'),
  declared('groovy', 'Groovy', 'apachegroovy', ['groovy'], 'groovy-language-server'),
  declared('cmake', 'CMake', 'cmake', ['cmake'], 'neocmakelsp'),
  declared('vue', 'Vue', 'vuedotjs', ['vue'], 'vue-language-server'),
  declared('svelte', 'Svelte', 'svelte', ['svelte'], 'svelteserver'),
  declared('proto', 'Protocol Buffers', 'protobuf', ['proto'], 'buf'),
]

/** Languages whose files run directly with an interpreter on PATH (`script` kind of `internal/languages/declared`). */
export const SCRIPT_LANGUAGES: readonly string[] = ['php', 'ruby', 'lua', 'dart', 'elixir', 'perl', 'r', 'julia', 'powershell']

/** .NET languages run their project with `dotnet run` (`dotnet` kind), debug it with netcoredbg and test with `dotnet test`. */
export { DOTNET_LANGUAGES }

/**
 * Native languages run and debug a built executable (`executable` kind, CodeLLDB like Rust);
 * the build itself is a Before launch task (make, cmake --build, zig build, swift build).
 */
export const DECLARED_LANGUAGES: readonly IdeLanguageContribution[] = ROWS.map((language) => {
  if (NATIVE_DEBUG_LANGUAGES.includes(language.id)) {
    return { ...language, runTemplates: [{ language: language.id, kind: 'executable', label: `${language.name} executable`, group: language.name }], canDebugRun: (config) => nativeDebugTargetOf(config) !== null }
  }
  if (SCRIPT_LANGUAGES.includes(language.id)) {
    const debug: Pick<IdeLanguageContribution, 'canDebugRun'> = SCRIPT_DEBUG_LANGUAGES.includes(language.id) ? { canDebugRun: (config) => nativeDebugTargetOf(config) !== null } : {}
    return { ...language, ...debug, runTemplates: [{ language: language.id, kind: 'script', label: `${language.name} script`, group: language.name }] }
  }
  if (DOTNET_LANGUAGES.includes(language.id)) {
    return { ...language, runTemplates: [{ language: language.id, kind: 'dotnet', label: `${language.name} project`, group: language.name }], canDebugRun: (config) => nativeDebugTargetOf(config) !== null }
  }
  return language
})
