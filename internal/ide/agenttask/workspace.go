package agenttask

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// WorkspaceState dice se la cartella isolata esiste ancora e può essere usata.
type WorkspaceState string

const (
	// WorkspaceReady: il worktree esiste ed è la directory di lavoro del task.
	WorkspaceReady WorkspaceState = "ready"
	// WorkspaceMissing: la cartella è sparita (rimossa a mano, disco esterno rimosso).
	// Il task resta consultabile: nessuna operazione riparte da sola.
	WorkspaceMissing WorkspaceState = "missing"
)

// Workspace è la cartella isolata (Git worktree) in cui lavora un task.
// Root del task resta la radice del progetto: le associazioni si riconciliano al riavvio.
type Workspace struct {
	Repository string         `json:"repository"`
	Path       string         `json:"path"`
	Branch     string         `json:"branch"`
	BaseRef    string         `json:"baseRef"`
	BaseSHA    string         `json:"baseSha,omitempty"`
	State      WorkspaceState `json:"state"`
	Notice     string         `json:"notice,omitempty"`
	CreatedAt  time.Time      `json:"createdAt"`
	// IncludedLocalChanges conta i file tracciati del progetto le cui modifiche non
	// committate sono state copiate nel worktree su richiesta esplicita dell'utente.
	// 0 = nessuna copia: il worktree contiene solo il commit di partenza.
	IncludedLocalChanges int `json:"includedLocalChanges,omitempty"`
	// Integration è l'ultima applicazione del workspace al progetto, se c'è stata.
	Integration Integration `json:"integration,omitzero"`
}

// WorkspaceRequest descrive la cartella da creare. L'ID del task determina il nome
// della cartella e del branch: nessun percorso arbitrario arriva dal renderer.
type WorkspaceRequest struct {
	TaskID   string
	RepoRoot string
	BaseRef  string
	// IncludeLocalChanges copia nel worktree le modifiche tracciate non committate del
	// progetto. Vale solo partendo da HEAD; i file non tracciati non vengono copiati.
	IncludeLocalChanges bool
}

// WorkspaceProvider crea, ispeziona, rimuove e misura le cartelle isolate.
// È implementato dall'host con i servizi Git esistenti: il core non esegue processi.
type WorkspaceProvider interface {
	Create(WorkspaceRequest) (Workspace, error)
	Inspect(Workspace) (WorkspaceState, string)
	Remove(Workspace) error
	// Fingerprint identifica il contenuto della directory di lavoro rispetto al
	// riferimento di partenza: le evidenze dichiarano sempre cosa hanno misurato.
	Fingerprint(path, baseRef string) (string, int, error)
}

func normalizeWorkspaceRequest(request WorkspaceRequest) (WorkspaceRequest, error) {
	request.TaskID = strings.TrimSpace(request.TaskID)
	request.RepoRoot = strings.TrimSpace(request.RepoRoot)
	request.BaseRef = strings.TrimSpace(request.BaseRef)
	if request.TaskID == "" {
		return WorkspaceRequest{}, errors.New("task ID is required")
	}
	for _, char := range request.TaskID {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
			return WorkspaceRequest{}, errors.New("task ID contains characters that are not allowed in a folder name")
		}
	}
	if request.RepoRoot == "" {
		return WorkspaceRequest{}, errors.New("project root is required")
	}
	request.RepoRoot = filepath.Clean(request.RepoRoot)
	if !filepath.IsAbs(request.RepoRoot) {
		return WorkspaceRequest{}, errors.New("project root must be an absolute path")
	}
	if request.BaseRef == "" {
		request.BaseRef = "HEAD"
	}
	if strings.HasPrefix(request.BaseRef, "-") || strings.ContainsAny(request.BaseRef, " \t\r\n\x00") {
		return WorkspaceRequest{}, fmt.Errorf("invalid starting reference %q", request.BaseRef)
	}
	return request, nil
}

// workdir è la directory in cui lavorano agente, verifiche e confronti.
func (task Task) workdir() string {
	if task.Workspace != nil && task.Workspace.State == WorkspaceReady && strings.TrimSpace(task.Workspace.Path) != "" {
		return task.Workspace.Path
	}
	return task.Root
}
