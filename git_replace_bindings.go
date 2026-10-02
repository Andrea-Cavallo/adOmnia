package main

import "adomnia/internal/git"

// LocalReplaces elenca i replace verso cartelle locali nei go.mod committati: da segnalare prima di un push.
func (g *GitSync) LocalReplaces(repoPath string) ([]git.LocalReplace, error) {
	return git.LocalReplacesAtHead(repoPath)
}
