package goide

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"adomnia/internal/git"
)

const (
	vcsQueryTimeout    = 10 * time.Second
	maxVCSHistory      = 100
	maxVCSChangedFiles = 2000
)

// VCSFileChange è un file modificato, con percorso relativo al progetto.
type VCSFileChange struct {
	RelativePath string `json:"relativePath"`
	Status       string `json:"status"`
	Staged       bool   `json:"staged"`
	Untracked    bool   `json:"untracked"`
	Conflicted   bool   `json:"conflicted"`
}

// VCSStatus descrive il repository Git che contiene il progetto, se esiste.
type VCSStatus struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
	RepoRoot  string `json:"repoRoot,omitempty"`
	Branch    string `json:"branch,omitempty"`
	// Head è l'hash dell'ultimo commit: quando cambia, i contenuti HEAD in cache vanno riletti.
	Head      string          `json:"head,omitempty"`
	Ahead     int             `json:"ahead"`
	Behind    int             `json:"behind"`
	Branches  []string        `json:"branches"`
	Changes   []VCSFileChange `json:"changes"`
	Conflicts int             `json:"conflicts"`
}

// VCSCommit è un commit della cronologia di un file.
type VCSCommit struct {
	Hash     string `json:"hash"`
	FullHash string `json:"fullHash"`
	Author   string `json:"author"`
	Date     string `json:"date"`
	Message  string `json:"message"`
}

// VCSBlameLine è l'autore di una riga del file su disco.
type VCSBlameLine struct {
	Line   int    `json:"line"`
	Hash   string `json:"hash"`
	Author string `json:"author"`
	Date   string `json:"date"`
}

// repositoryRoot trova la radice del repository Git che contiene il progetto; stringa vuota se non c'è.
func repositoryRoot(projectRoot string) (string, error) {
	binary, err := exec.LookPath("git")
	if err != nil {
		return "", errors.New("git non è installato o non è nel PATH")
	}
	ctx, cancel := context.WithTimeout(context.Background(), vcsQueryTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "rev-parse", "--show-toplevel")
	command.Dir = projectRoot
	configureProcess(command, false)
	output, err := command.Output()
	if err != nil {
		return "", nil
	}
	root := strings.TrimSpace(string(output))
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	return root, nil
}

// vcsPaths converte tra percorsi del progetto e del repository (il progetto può essere una sottocartella).
type vcsPaths struct {
	projectRoot string
	repoRoot    string
}

func (p vcsPaths) toRepo(relativePath string) (string, error) {
	absolute := filepath.Clean(filepath.Join(p.projectRoot, filepath.FromSlash(relativePath)))
	if err := ensureWithinRoot(p.projectRoot, absolute); err != nil {
		return "", err
	}
	relative, err := filepath.Rel(p.repoRoot, absolute)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(relative), nil
}

// toProject restituisce il percorso relativo al progetto, o false se il file è fuori dal progetto.
func (p vcsPaths) toProject(repoPath string) (string, bool) {
	absolute := filepath.Join(p.repoRoot, filepath.FromSlash(repoPath))
	relative, err := filepath.Rel(p.projectRoot, absolute)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filepath.ToSlash(relative), true
}

func (s *Service) vcsPaths(sessionID string) (Session, vcsPaths, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Session{}, vcsPaths{}, err
	}
	root, err := repositoryRoot(session.Project.RealPath)
	if err != nil {
		return Session{}, vcsPaths{}, err
	}
	if root == "" {
		return Session{}, vcsPaths{}, fmt.Errorf("il progetto non è in un repository Git")
	}
	return session, vcsPaths{projectRoot: session.Project.RealPath, repoRoot: root}, nil
}

// VCSStatus legge branch, file modificati e branch locali; non esegue mai operazioni di rete.
func (s *Service) VCSStatus(sessionID string) (VCSStatus, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return VCSStatus{}, err
	}
	root, err := repositoryRoot(session.Project.RealPath)
	if err != nil {
		return VCSStatus{Reason: err.Error(), Branches: []string{}, Changes: []VCSFileChange{}}, nil
	}
	if root == "" {
		return VCSStatus{Reason: "Not a Git repository", Branches: []string{}, Changes: []VCSFileChange{}}, nil
	}
	paths := vcsPaths{projectRoot: session.Project.RealPath, repoRoot: root}
	overview, err := git.GetOverview(root, 0)
	if err != nil {
		return VCSStatus{}, err
	}
	status := VCSStatus{
		Available: true, RepoRoot: root, Branch: overview.Status.Branch, Ahead: overview.Status.AheadCount, Behind: overview.Status.BehindCount,
		Branches: []string{}, Changes: []VCSFileChange{}, Conflicts: len(overview.Conflicts),
	}
	if len(overview.Commits) > 0 {
		status.Head = overview.Commits[0].FullHash
	}
	for _, branch := range overview.Branches {
		if !branch.Remote {
			status.Branches = append(status.Branches, branch.Name)
		}
	}
	for _, change := range overview.Changes {
		relative, inside := paths.toProject(change.Path)
		if !inside || len(status.Changes) >= maxVCSChangedFiles {
			continue
		}
		status.Changes = append(status.Changes, VCSFileChange{
			RelativePath: relative, Status: change.Status, Staged: strings.TrimSpace(change.Index) != "" && change.Index != "?",
			Untracked: change.Index == "?", Conflicted: change.Conflicted,
		})
	}
	return status, nil
}

// VCSFileAtRevision restituisce il contenuto del file a una revisione (HEAD per il gutter diff); vuoto se non esisteva.
func (s *Service) VCSFileAtRevision(sessionID, relativePath, revision string) (string, error) {
	_, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return "", err
	}
	repoPath, err := paths.toRepo(relativePath)
	if err != nil {
		return "", err
	}
	if revision = strings.TrimSpace(revision); revision == "" || strings.HasPrefix(revision, "-") {
		return "", fmt.Errorf("revisione non valida")
	}
	return git.FileAtCommit(paths.repoRoot, revision, repoPath)
}

// VCSFileHistory elenca i commit che hanno toccato il file, seguendo i rename.
func (s *Service) VCSFileHistory(sessionID, relativePath string) ([]VCSCommit, error) {
	_, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return nil, err
	}
	repoPath, err := paths.toRepo(relativePath)
	if err != nil {
		return nil, err
	}
	commits, err := git.FileHistory(paths.repoRoot, repoPath, maxVCSHistory)
	if err != nil {
		return nil, err
	}
	return vcsCommits(commits), nil
}

// VCSLineHistory elenca i commit che hanno modificato le righe start..end (1-based) del file salvato.
func (s *Service) VCSLineHistory(sessionID, relativePath string, start, end int) ([]VCSCommit, error) {
	_, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return nil, err
	}
	repoPath, err := paths.toRepo(relativePath)
	if err != nil {
		return nil, err
	}
	commits, err := git.LineHistory(paths.repoRoot, repoPath, start, end, maxVCSHistory)
	if err != nil {
		return nil, err
	}
	return vcsCommits(commits), nil
}

func vcsCommits(commits []git.CommitInfo) []VCSCommit {
	result := make([]VCSCommit, 0, len(commits))
	for _, commit := range commits {
		result = append(result, VCSCommit{Hash: commit.Hash, FullHash: commit.FullHash, Author: commit.Author, Date: commit.Date, Message: commit.Message})
	}
	return result
}

// VCSPatchLines restituisce, per file Go del progetto, le righe aggiunte o modificate dal merge-base
// con base (incluse le modifiche non committate): il perimetro di una pull request. Le sole
// cancellazioni non hanno righe da coprire e vengono omesse.
func (s *Service) VCSPatchLines(sessionID, base string) (map[string][]git.LineRange, error) {
	_, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return nil, err
	}
	changed, err := git.ChangedLinesSince(paths.repoRoot, base)
	if err != nil {
		return nil, err
	}
	result := map[string][]git.LineRange{}
	for repoPath, ranges := range changed {
		relative, ok := paths.toProject(repoPath)
		if !ok {
			continue
		}
		for _, changedRange := range ranges {
			if !changedRange.Deletion {
				result[relative] = append(result[relative], changedRange)
			}
		}
	}
	return result, nil
}

// VCSBlame restituisce autore, commit e data di ogni riga del file salvato.
func (s *Service) VCSBlame(sessionID, relativePath string) ([]VCSBlameLine, error) {
	_, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return nil, err
	}
	repoPath, err := paths.toRepo(relativePath)
	if err != nil {
		return nil, err
	}
	lines, err := git.BlameLines(paths.repoRoot, repoPath)
	if err != nil {
		return nil, err
	}
	result := make([]VCSBlameLine, 0, len(lines))
	for _, line := range lines {
		result = append(result, VCSBlameLine{Line: line.LineNumber, Hash: line.Hash, Author: line.Author, Date: line.Date})
	}
	return result, nil
}

// VCSCommitFiles registra solo i file indicati del progetto, dopo conferma esplicita nell'interfaccia.
func (s *Service) VCSCommitFiles(sessionID, message string, relativePaths []string) (git.CommitResult, error) {
	_, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return git.CommitResult{}, err
	}
	repoPaths := make([]string, 0, len(relativePaths))
	for _, relativePath := range relativePaths {
		repoPath, err := paths.toRepo(relativePath)
		if err != nil {
			return git.CommitResult{}, err
		}
		repoPaths = append(repoPaths, repoPath)
	}
	return git.CommitPaths(paths.repoRoot, message, repoPaths)
}

// VCSCheckout passa a un branch locale esistente; Git rifiuta se le modifiche locali andrebbero perse.
func (s *Service) VCSCheckout(sessionID, branch string) error {
	_, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return err
	}
	branch = strings.TrimSpace(branch)
	if branch == "" || strings.HasPrefix(branch, "-") {
		return fmt.Errorf("nome di branch non valido")
	}
	// Solo branch locali esistenti: "git checkout <nome>" su un nome di file ripristinerebbe il file.
	overview, err := git.GetOverview(paths.repoRoot, 1)
	if err != nil {
		return err
	}
	for _, candidate := range overview.Branches {
		if !candidate.Remote && candidate.Name == branch {
			return git.CheckoutBranch(paths.repoRoot, branch)
		}
	}
	return fmt.Errorf("branch locale %q non trovato", branch)
}
