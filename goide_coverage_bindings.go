package main

import "adomnia/internal/goide"

// BaseBranchCoverage misura la coverage degli stessi package sul merge-base con base, in un worktree temporaneo.
func (g *GoIDE) BaseBranchCoverage(sessionID, base string, packageDirs, buildTags []string) (goide.BaseCoverage, error) {
	return g.service.BaseBranchCoverage(sessionID, base, packageDirs, buildTags)
}
