package main

import "github.com/Andrea-Cavallo/adOmnia/internal/codestudio"

// BaseBranchCoverage misura la coverage degli stessi package sul merge-base con base, in un worktree temporaneo.
func (g *GoIDE) BaseBranchCoverage(sessionID, base string, packageDirs, buildTags []string) (codestudio.BaseCoverage, error) {
	return g.service.BaseBranchCoverage(sessionID, base, packageDirs, buildTags)
}

// DebugGoroutineCreation restituisce l'istruzione go che ha creato la goroutine del thread indicato.
func (g *GoIDE) DebugGoroutineCreation(debugID string, threadID int) (codestudio.GoroutineCreation, error) {
	return g.service.DebugGoroutineCreation(debugID, threadID)
}

// DebugPendingDefers restituisce i defer registrati a runtime dalla goroutine, in ordine di esecuzione.
func (g *GoIDE) DebugPendingDefers(debugID string, threadID int) ([]codestudio.PendingDefer, error) {
	return g.service.DebugPendingDefers(debugID, threadID)
}

// MoveSymbol sposta una dichiarazione in un altro package del modulo; restituisce l'anteprima delle modifiche.
func (g *GoIDE) MoveSymbol(sessionID string, request codestudio.MoveSymbolRequest) (codestudio.WorkspaceChange, error) {
	return g.service.MoveSymbol(sessionID, request)
}

// VCSWorkingDiff restituisce un file in HEAD e su disco, per il diff nel dialog di commit.
func (g *GoIDE) VCSWorkingDiff(sessionID, relativePath string) (codestudio.VCSWorkingDiff, error) {
	return g.service.VCSWorkingDiff(sessionID, relativePath)
}
