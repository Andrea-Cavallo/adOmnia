// Package ide is the root of adOmnia's IDE Platform, the language-agnostic core behind Code Studio.
//
// Its subpackages (language, project, lsp, dap, run, testing, sdk, process and others) never import a language adapter: adapters live in internal/languages and are composed by internal/codestudio. The architecture tests in this package enforce that direction.
package ide
