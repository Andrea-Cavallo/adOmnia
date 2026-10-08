package main

import (
	"adomnia/internal/goide"
	"adomnia/internal/plugins"
)

func (g *GoIDE) RemoteSourceFiles(sessionID string) ([]string, error) {
	return g.service.RemoteSourceFiles(sessionID)
}

func (g *GoIDE) IDEContributions() []plugins.Contribution { return g.service.IDEContributions() }
func (g *GoIDE) InvokeIDEExtension(request goide.IDEExtensionRequest) (plugins.ExecResult, error) {
	return g.service.InvokeIDEExtension(request)
}
func (g *GoIDE) StartExtensionLanguageServer(sessionID, languageID string) (goide.LanguageServerStatus, error) {
	return g.service.StartExtensionLanguageServer(sessionID, languageID)
}
func (g *GoIDE) StopExtensionLanguageServer(sessionID, languageID string) error {
	return g.service.StopExtensionLanguageServer(sessionID, languageID)
}
func (g *GoIDE) ExtensionLanguageStatus(sessionID, languageID string) (goide.LanguageServerStatus, error) {
	return g.service.ExtensionLanguageStatus(sessionID, languageID)
}
