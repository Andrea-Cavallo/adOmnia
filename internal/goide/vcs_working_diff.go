package goide

import (
	"strings"

	"adomnia/internal/git"
)

// maxWorkingDiffBytes oltre il quale il dialog di commit non mostra il diff (file generati, dump).
const maxWorkingDiffBytes = 2 << 20

// VCSWorkingDiff è un file confrontato tra HEAD e la copia di lavoro, per il dialog di commit.
type VCSWorkingDiff struct {
	RelativePath string `json:"relativePath"`
	Original     string `json:"original"`
	Modified     string `json:"modified"`
	// Binary o TooLarge: il contenuto non viene inviato, il dialog lo spiega.
	Binary   bool `json:"binary,omitempty"`
	TooLarge bool `json:"tooLarge,omitempty"`
}

// VCSWorkingDiff legge il file in HEAD e su disco (vuoti per file nuovi o cancellati); nessuna rete.
func (s *Service) VCSWorkingDiff(sessionID, relativePath string) (VCSWorkingDiff, error) {
	_, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return VCSWorkingDiff{}, err
	}
	repoPath, err := paths.toRepo(relativePath)
	if err != nil {
		return VCSWorkingDiff{}, err
	}
	snapshot, err := git.GetWorkingTreeFileSnapshot(paths.repoRoot, repoPath, "")
	if err != nil {
		return VCSWorkingDiff{}, err
	}
	result := VCSWorkingDiff{RelativePath: relativePath}
	switch {
	case strings.ContainsRune(snapshot.OldContent, 0) || strings.ContainsRune(snapshot.NewContent, 0):
		result.Binary = true
	case len(snapshot.OldContent)+len(snapshot.NewContent) > maxWorkingDiffBytes:
		result.TooLarge = true
	default:
		result.Original, result.Modified = snapshot.OldContent, snapshot.NewContent
	}
	return result, nil
}
