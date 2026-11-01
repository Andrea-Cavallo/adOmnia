package lsp

import "path/filepath"

// NPM is the npm CLI executable name. Language servers distributed through npm are installed with it.
const NPM = "npm"

// ManagedToolsPrefix is the folder where adOmnia installs npm-distributed language servers with
// `npm install --prefix`. Every adapter that downloads a server shares it, so two adapters never
// install the same server twice and none of them depends on another adapter to find it.
func ManagedToolsPrefix(toolsRoot string) string {
	return filepath.Join(toolsRoot, "node")
}

// ManagedBinDirectory is `node_modules/.bin` inside the managed tools folder: where npm puts the
// server shims that the host runs.
func ManagedBinDirectory(toolsRoot string) string {
	return filepath.Join(ManagedToolsPrefix(toolsRoot), "node_modules", ".bin")
}
