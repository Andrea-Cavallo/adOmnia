package web

import (
	"fmt"
	"os"
	"strings"

	"adomnia/internal/ide/lsp"
)

// Installazione dei language server web: un solo `npm install` nella cartella strumenti di adOmnia
// serve tutti e quattro i linguaggi.
const installTask = "install-web-language-servers"

// LocateServer implementa lsp.ServerProvider.
func (a adapter) LocateServer(root, toolsRoot string) lsp.ServerInfo {
	info := LocateServer(a.id, root, "", toolsRoot)
	return lsp.ServerInfo{Language: info.Language, Name: info.Name, Available: info.Available, Binary: info.Binary, Source: info.Source, Error: info.Error}
}

// ServerSpec implementa lsp.ServerProvider.
func (a adapter) ServerSpec(root, toolsRoot string) (lsp.ServerSpec, error) {
	return ServerSpec(LocateServer(a.id, root, "", toolsRoot))
}

// InstallPlan implementa lsp.ServerProvider.
func (a adapter) InstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if toolsRoot == "" {
		return lsp.InstallPlan{}, fmt.Errorf("adOmnia tools folder not configured")
	}
	runtimeInfo := DetectRuntime(NPM)
	if !runtimeInfo.Ready() {
		return lsp.InstallPlan{}, fmt.Errorf("%s: npm is needed to install the web language servers", runtimeInfo.Problem)
	}
	prefix := ManagedPrefix(toolsRoot)
	arguments := append([]string{"install", "--no-audit", "--no-fund", "--prefix", prefix}, ManagedPackages...)
	return lsp.InstallPlan{
		Task: installTask, Title: "Install the web language servers?", Label: "Installing language servers…",
		Note:       "Downloads the packages from the npm registry into adOmnia's own tools folder, never into your project. It also runs their install scripts. The output appears in the Run console.",
		Command:    "npm install --prefix <adOmnia tools folder> " + strings.Join(ManagedPackages, " "),
		Executable: runtimeInfo.PackageManagerBinary, Arguments: arguments, Directory: prefix,
		Prepare:   func() error { return os.MkdirAll(prefix, 0o755) },
		Languages: ServerLanguages(),
	}, nil
}
