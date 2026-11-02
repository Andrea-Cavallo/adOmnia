package codestudio

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/git"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/agenttask"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/fileio"
)

// GitWorkspaceProvider creates the isolated workspace of an agent task with the
// existing Git services. Worktrees live under the app data folder, never inside
// the project: the user's working tree and its local changes stay untouched.
type GitWorkspaceProvider struct {
	root string
	mu   sync.Mutex
}

// NewGitWorkspaceProvider uses root as the parent folder for every worktree.
func NewGitWorkspaceProvider(root string) *GitWorkspaceProvider {
	return &GitWorkspaceProvider{root: filepath.Clean(root)}
}

var _ agenttask.WorkspaceProvider = (*GitWorkspaceProvider)(nil)

func (provider *GitWorkspaceProvider) Create(request agenttask.WorkspaceRequest) (agenttask.Workspace, error) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	repoRoot := filepath.Clean(request.RepoRoot)
	// A real repository is required: ListWorktrees fails otherwise, before anything is written.
	if _, err := git.ListWorktrees(repoRoot); err != nil {
		return agenttask.Workspace{}, fmt.Errorf("this project is not a Git repository: %w", err)
	}
	meta, err := git.GetCommitMeta(repoRoot, request.BaseRef)
	if err != nil {
		return agenttask.Workspace{}, fmt.Errorf("the starting reference %q does not exist: %w", request.BaseRef, err)
	}
	var localPatch string
	if request.IncludeLocalChanges {
		if localPatch, err = localChangesPatch(repoRoot, meta.FullHash); err != nil {
			return agenttask.Workspace{}, err
		}
	}
	branch := workspaceBranch(request.TaskID)
	path := filepath.Join(provider.root, request.TaskID)
	if !withinRoot(provider.root, path) {
		return agenttask.Workspace{}, errors.New("the workspace folder is outside the managed directory")
	}
	if _, err := os.Stat(path); err == nil {
		return agenttask.Workspace{}, fmt.Errorf("a folder already exists at %s; remove it before creating the workspace again", path)
	}
	if err := os.MkdirAll(provider.root, 0o700); err != nil {
		return agenttask.Workspace{}, fmt.Errorf("create the workspace folder: %w", err)
	}
	if err := git.AddWorktreeFrom(repoRoot, path, branch, meta.FullHash); err != nil {
		return agenttask.Workspace{}, fmt.Errorf("create the isolated workspace: %w", err)
	}
	// La policy AI del progetto decide quali provider possono vedere il codice. Il
	// worktree parte dal commit, quindi una policy locale non committata mancherebbe:
	// si copia dal working tree del progetto prima che l'agente apra la sessione.
	if err := copyProjectAIPolicy(repoRoot, path); err != nil {
		_ = git.RemoveWorktree(repoRoot, path, true)
		return agenttask.Workspace{}, err
	}
	included := 0
	if localPatch != "" {
		if result := git.ApplyPatch(path, localPatch, false, false); !result.Success {
			_ = git.RemoveWorktree(repoRoot, path, true) // best-effort: the folder was created a moment ago and holds no user work
			return agenttask.Workspace{}, fmt.Errorf("copy the local changes into the workspace: %s", firstText(result.Error, result.Stderr, "git apply failed"))
		}
		included = strings.Count(localPatch, "\ndiff --git ") + 1
	}
	return agenttask.Workspace{
		Repository: repoRoot, Path: path, Branch: branch, BaseRef: request.BaseRef,
		BaseSHA: meta.FullHash, State: agenttask.WorkspaceReady, CreatedAt: time.Now().UTC(),
		IncludedLocalChanges: included,
	}, nil
}

// localChangesPatch reads the project's uncommitted tracked changes as a binary
// patch. They are relative to HEAD, so they can only start a workspace from HEAD.
func localChangesPatch(repoRoot, baseSHA string) (string, error) {
	head, err := git.GetCommitMeta(repoRoot, "HEAD")
	if err != nil {
		return "", fmt.Errorf("read the project HEAD: %w", err)
	}
	if head.FullHash != baseSHA {
		return "", errors.New("local changes are relative to the current commit: start the workspace from HEAD to include them")
	}
	patch, err := git.ChangesDiff(repoRoot, "working", "")
	if err != nil {
		return "", fmt.Errorf("read the local changes: %w", err)
	}
	if strings.TrimSpace(patch) == "" {
		return "", errors.New("the project has no uncommitted changes to tracked files to include")
	}
	return patch, nil
}

func firstText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (provider *GitWorkspaceProvider) Inspect(workspace agenttask.Workspace) (agenttask.WorkspaceState, string) {
	path := filepath.Clean(workspace.Path)
	if _, err := os.Stat(path); err != nil {
		return agenttask.WorkspaceMissing, "the workspace folder no longer exists; the task is kept but the agent cannot work in it"
	}
	// L'associazione salvata vale solo se Git elenca ancora questo worktree: una
	// cartella rimossa e ricreata fuori da adOmnia non viene adottata per errore.
	items, err := git.ListWorktrees(workspace.Repository)
	if err != nil {
		// Non poter leggere il repository non significa che il worktree sia sparito:
		// lo stato precedente resta e il limite viene dichiarato.
		return workspace.State, "the repository could not be read, so the workspace state was not verified"
	}
	for _, item := range items {
		if samePath(item.Path, path) {
			return agenttask.WorkspaceReady, ""
		}
	}
	return agenttask.WorkspaceMissing, "the folder is no longer a worktree registered by Git; nothing was removed and the task is kept"
}

func (provider *GitWorkspaceProvider) Remove(workspace agenttask.Workspace) error {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if strings.TrimSpace(workspace.Path) == "" {
		return errors.New("workspace path is required")
	}
	// La copia della policy è nostra: se è ancora identica e non è tracciata dal
	// commit di partenza, toglierla non è una perdita. Qualunque altra modifica
	// resta e blocca la rimozione, come deve.
	removeMirroredPolicy(workspace)
	// force=false: Git refuses to delete a worktree with unsaved changes, and the
	// message tells the user to review them first. adOmnia never discards work here.
	if err := git.RemoveWorktree(workspace.Repository, workspace.Path, false); err != nil {
		return fmt.Errorf("remove the isolated workspace: %w", err)
	}
	return nil
}

func removeMirroredPolicy(workspace agenttask.Workspace) {
	relative := filepath.Join(".adomnia", "ai-policy.json")
	ref := workspace.BaseSHA
	if strings.TrimSpace(ref) == "" {
		ref = "HEAD"
	}
	if git.FileExistsAtCommit(workspace.Repository, ref, filepath.ToSlash(relative)) {
		return
	}
	target := filepath.Join(workspace.Path, relative)
	mirrored, err := os.ReadFile(target) // #nosec G304 -- fixed path inside the managed worktree
	if err != nil {
		return
	}
	project, err := os.ReadFile(filepath.Join(workspace.Repository, relative)) // #nosec G304 -- fixed project-relative policy file
	if err != nil || string(mirrored) != string(project) {
		return
	}
	_ = os.Remove(target) // best-effort: the removal below reports anything that still blocks it
}

func (provider *GitWorkspaceProvider) Fingerprint(path, baseRef string) (string, int, error) {
	ref := strings.TrimSpace(baseRef)
	if ref == "" {
		ref = "HEAD"
	}
	return git.WorkingTreeFingerprint(path, ref)
}

// copyProjectAIPolicy mirrors the project's AI policy into the worktree. The policy
// is a configuration decision about which provider may see the code; running the
// agent in a checkout that silently reverts it to "allowed" would be a regression.
func copyProjectAIPolicy(repoRoot, worktreePath string) error {
	relative := filepath.Join(".adomnia", "ai-policy.json")
	source := filepath.Join(repoRoot, relative)
	content, err := os.ReadFile(source) // #nosec G304 -- fixed project-relative policy file
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read the project AI policy: %w", err)
	}
	target := filepath.Join(worktreePath, relative)
	if existing, readErr := os.ReadFile(target); readErr == nil && string(existing) == string(content) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return fmt.Errorf("copy the project AI policy into the workspace: %w", err)
	}
	if err := fileio.AtomicWriteFile(target, content, 0o600); err != nil {
		return fmt.Errorf("copy the project AI policy into the workspace: %w", err)
	}
	return nil
}

// workspaceBranch names the branch predictably (adomnia/task-<short id>).
func workspaceBranch(taskID string) string {
	short := strings.TrimPrefix(taskID, "task-")
	if len(short) > 12 {
		short = short[:12]
	}
	if short == "" {
		short = fmt.Sprintf("task-%d", time.Now().UnixNano())
	}
	return "adomnia/" + short
}

func withinRoot(root, path string) bool {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(path))
	if err != nil {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

var _ agenttask.WorkspaceIntegrator = (*GitWorkspaceProvider)(nil)

// Compare reads the workspace changes and the project branch that would receive them.
func (provider *GitWorkspaceProvider) Compare(workspace agenttask.Workspace) (agenttask.WorkspaceComparison, error) {
	fingerprint, _, err := git.WorkingTreeFingerprint(workspace.Path, workspace.BaseSHA)
	if err != nil {
		return agenttask.WorkspaceComparison{}, fmt.Errorf("read the workspace changes: %w", err)
	}
	_, files, err := git.WorkspacePatch(workspace.Path, workspace.BaseSHA)
	if err != nil {
		return agenttask.WorkspaceComparison{}, fmt.Errorf("read the workspace changes: %w", err)
	}
	target, err := git.CompareTarget(workspace.Repository, workspace.BaseSHA)
	if err != nil {
		return agenttask.WorkspaceComparison{}, fmt.Errorf("read the project branch: %w", err)
	}
	return agenttask.WorkspaceComparison{
		Fingerprint: fingerprint, ChangedFiles: nonNil(files),
		TargetBranch: target.Branch, TargetHead: target.Head, TargetCommits: target.CommitsSinceBase,
		TargetChanged: nonNil(target.ChangedSinceBase), LocalChanges: nonNil(target.LocalChanges),
	}, nil
}

// Integrate applies the workspace to the project's current branch with a 3-way merge,
// staged and never committed. With check nothing changes.
func (provider *GitWorkspaceProvider) Integrate(workspace agenttask.Workspace, check bool) (agenttask.Integration, error) {
	fingerprint, _, err := git.WorkingTreeFingerprint(workspace.Path, workspace.BaseSHA)
	if err != nil {
		return agenttask.Integration{}, fmt.Errorf("read the workspace changes: %w", err)
	}
	patch, files, err := git.WorkspacePatch(workspace.Path, workspace.BaseSHA)
	if err != nil {
		return agenttask.Integration{}, fmt.Errorf("read the workspace changes: %w", err)
	}
	if len(files) == 0 {
		return agenttask.Integration{}, errors.New("the workspace has no changes to integrate")
	}
	target, err := git.CompareTarget(workspace.Repository, workspace.BaseSHA)
	if err != nil {
		return agenttask.Integration{}, fmt.Errorf("read the project branch: %w", err)
	}
	result, err := git.IntegratePatch(workspace.Repository, patch, check)
	if err != nil {
		return agenttask.Integration{}, err
	}
	return agenttask.Integration{
		Applied: result.Applied, TargetBranch: target.Branch, TargetHead: target.Head,
		Fingerprint: fingerprint, Files: files, Conflicts: nonNil(result.Conflicts), Output: result.Output,
	}, nil
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

// SetAgentWorktreeRoot tells the service where agent task worktrees live, so a task
// workspace opened in Code Studio inherits the trust of its project.
func (s *Service) SetAgentWorktreeRoot(root string) {
	s.agentWorktrees.Store(filepath.Clean(root))
}

// worktreeTrusted reports whether realPath is an adOmnia-managed task worktree whose
// project the user already trusted. The trust is derived at every open and never
// saved: revoking the project's trust also stops it from reaching the worktree.
func (s *Service) worktreeTrusted(realPath string) bool {
	root, _ := s.agentWorktrees.Load().(string)
	if root == "" || !withinRoot(root, realPath) || samePath(root, realPath) {
		return false
	}
	repo, err := git.MainRepository(realPath)
	if err != nil {
		return false
	}
	if resolved, err := filepath.EvalSymlinks(repo); err == nil {
		repo = resolved
	}
	return s.isTrusted(repo)
}

// OnTrustRevoked registers what to stop when the user revokes a project's trust.
func (s *Service) OnTrustRevoked(stop func(realPath string)) {
	s.trustRevoked.Store(stop)
}

var _ agenttask.WorkspaceCommitter = (*GitWorkspaceProvider)(nil)

// PendingFiles lists the uncommitted changes of the task workspace.
func (provider *GitWorkspaceProvider) PendingFiles(workspace agenttask.Workspace) ([]string, error) {
	return git.PendingFiles(workspace.Path)
}

// Commit records the pending changes on the task branch, inside the workspace only.
func (provider *GitWorkspaceProvider) Commit(workspace agenttask.Workspace, message string) (string, []string, error) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	sha, files, err := git.CommitWorktree(workspace.Path, message)
	if err != nil {
		return "", nil, fmt.Errorf("commit the step: %w", err)
	}
	return sha, files, nil
}
