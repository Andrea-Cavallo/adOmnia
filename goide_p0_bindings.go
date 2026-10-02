package main

import "adomnia/internal/goide"

// BaseBranchCoverage misura la coverage degli stessi package sul merge-base con base, in un worktree temporaneo.
func (g *GoIDE) BaseBranchCoverage(sessionID, base string, packageDirs, buildTags []string) (goide.BaseCoverage, error) {
	return g.service.BaseBranchCoverage(sessionID, base, packageDirs, buildTags)
}

// DebugGoroutineCreation restituisce l'istruzione go che ha creato la goroutine del thread indicato.
func (g *GoIDE) DebugGoroutineCreation(debugID string, threadID int) (goide.GoroutineCreation, error) {
	return g.service.DebugGoroutineCreation(debugID, threadID)
}
