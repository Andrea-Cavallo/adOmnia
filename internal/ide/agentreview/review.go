// Package agentreview mostra cosa ha cambiato un agente AI (milk, Claude Code…) durante un turno di chat
// e permette di accettare o rifiutare ogni modifica.
//
// All'inizio del turno il Tracker fotografa in memoria i file di testo del progetto; alla fine confronta il
// disco con la foto. Ogni file cambiato resta in review con il suo contenuto di partenza (baseline) finché
// l'utente non accetta (la baseline diventa il contenuto attuale) o rifiuta (il disco torna alla baseline).
// Niente viene scritto su disco dal Tracker se non su richiesta esplicita dell'utente. La review vive solo in
// memoria: si perde chiudendo l'app.
package agentreview

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"adomnia/internal/ide/fileio"
)

// ChangedEvent è l'evento emesso quando la review di un progetto cambia.
const ChangedEvent = "agentReview.changed"

// FileStatus dice come l'agente ha cambiato un file.
type FileStatus string

const (
	StatusAdded    FileStatus = "added"
	StatusModified FileStatus = "modified"
	StatusDeleted  FileStatus = "deleted"
)

// ErrStale: il file è cambiato su disco dopo che la review è stata mostrata.
var ErrStale = errors.New("the file changed after the review was shown: review it again")

// FileChange è un file in attesa di revisione.
type FileChange struct {
	Path   string     `json:"path"`
	Status FileStatus `json:"status"`
	// Baseline è il contenuto prima dell'agente (vuoto per un file nuovo), Current quello su disco (vuoto se eliminato o non leggibile).
	Baseline string `json:"baseline"`
	Current  string `json:"current"`
	// Reviewable è false per i file binari o troppo grandi: si possono solo accettare.
	Reviewable bool   `json:"reviewable"`
	Agent      string `json:"agent"`
}

// Review è lo stato della revisione di un progetto.
type Review struct {
	Root  string       `json:"root"`
	Files []FileChange `json:"files"`
	// Notice spiega perché l'ultimo turno non è stato registrato (progetto troppo grande, cartella illeggibile).
	Notice string `json:"notice,omitempty"`
}

// ChangedPayload accompagna ChangedEvent.
type ChangedPayload struct {
	Root  string `json:"root"`
	Files int    `json:"files"`
}

// pendingFile è un file in review. baseline è nil se il file non esisteva prima dell'agente.
type pendingFile struct {
	baseline   *string
	reviewable bool
	agent      string
}

type projectReview struct {
	files  map[string]*pendingFile
	notice string
}

// Tracker conserva le review per cartella di progetto.
type Tracker struct {
	mu       sync.Mutex
	projects map[string]*projectReview
	emit     func(event string, payload any)
}

// NewTracker crea un tracker vuoto.
func NewTracker() *Tracker {
	return &Tracker{projects: map[string]*projectReview{}}
}

// SetEmitter collega la pubblicazione degli eventi verso il frontend.
func (t *Tracker) SetEmitter(emit func(event string, payload any)) {
	t.mu.Lock()
	t.emit = emit
	t.mu.Unlock()
}

// BeginTurn fotografa il progetto prima di un turno dell'agente; la funzione restituita chiude il turno
// e registra i file cambiati. È sicura da chiamare anche se la foto non è riuscita.
func (t *Tracker) BeginTurn(root, agent string) func() {
	root = cleanRoot(root)
	if root == "" {
		return func() {}
	}
	baseline, err := captureBaseline(root)
	if err != nil {
		t.setNotice(root, unavailableMessage(err))
		return func() {}
	}
	return func() { t.endTurn(root, agent, baseline) }
}

func (t *Tracker) endTurn(root, agent string, baseline map[string]baselineFile) {
	current, err := scanProject(root)
	if err != nil {
		t.setNotice(root, unavailableMessage(err))
		return
	}
	t.mu.Lock()
	project := t.projectLocked(root)
	project.notice = ""
	for _, relative := range changedPaths(baseline, current) {
		if _, tracked := project.files[relative]; tracked {
			continue // la baseline più vecchia resta: la review copre tutti i turni non ancora rivisti
		}
		project.files[relative] = pendingFromBaseline(baseline, relative, agent)
	}
	t.pruneLocked(root, project)
	t.mu.Unlock()
	t.publish(root)
}

func pendingFromBaseline(baseline map[string]baselineFile, relative, agent string) *pendingFile {
	before, existed := baseline[relative]
	if !existed {
		return &pendingFile{reviewable: true, agent: agent}
	}
	return &pendingFile{baseline: before.text, reviewable: before.text != nil, agent: agent}
}

// changedPaths elenca i file aggiunti, eliminati o con impronta diversa. Un file riscritto con lo stesso
// contenuto non conta: pruneLocked lo scarta confrontando il testo.
func changedPaths(baseline map[string]baselineFile, current map[string]fingerprint) []string {
	var changed []string
	for relative, before := range baseline {
		after, exists := current[relative]
		if !exists || after != before.fingerprint {
			changed = append(changed, relative)
		}
	}
	for relative := range current {
		if _, existed := baseline[relative]; !existed {
			changed = append(changed, relative)
		}
	}
	return changed
}

// Get restituisce la review di un progetto con il contenuto attuale dei file.
func (t *Tracker) Get(root string) Review {
	root = cleanRoot(root)
	t.mu.Lock()
	defer t.mu.Unlock()
	review := Review{Root: root, Files: []FileChange{}}
	project := t.projects[root]
	if project == nil {
		return review
	}
	t.pruneLocked(root, project)
	review.Notice = project.notice
	for relative, file := range project.files {
		review.Files = append(review.Files, describe(root, relative, file))
	}
	sort.Slice(review.Files, func(left, right int) bool { return review.Files[left].Path < review.Files[right].Path })
	return review
}

func describe(root, relative string, file *pendingFile) FileChange {
	change := FileChange{Path: relative, Agent: file.agent, Reviewable: file.reviewable}
	current, exists, readable := readCurrent(root, relative)
	switch {
	case file.baseline == nil && file.reviewable:
		change.Status = StatusAdded
	case !exists:
		change.Status = StatusDeleted
	default:
		change.Status = StatusModified
	}
	if !readable {
		change.Reviewable = false
	}
	if file.baseline != nil {
		change.Baseline = *file.baseline
	}
	change.Current = current
	return change
}

// pruneLocked toglie i file tornati uguali alla baseline (anche per mano dell'utente).
func (t *Tracker) pruneLocked(root string, project *projectReview) {
	for relative, file := range project.files {
		current, exists, readable := readCurrent(root, relative)
		unchangedText := file.baseline != nil && exists && readable && current == *file.baseline
		stillAbsent := file.baseline == nil && file.reviewable && !exists
		if unchangedText || stillAbsent {
			delete(project.files, relative)
		}
	}
}

// AcceptFile tiene la versione dell'agente.
func (t *Tracker) AcceptFile(root, relative string) error {
	return t.update(root, func(project *projectReview) error {
		if _, err := pendingAt(project, relative); err != nil {
			return err
		}
		delete(project.files, relative)
		return nil
	})
}

// RejectFile riporta il file com'era prima dell'agente (o lo elimina se l'agente lo ha creato).
func (t *Tracker) RejectFile(root, relative string) error {
	return t.update(root, func(project *projectReview) error {
		file, err := pendingAt(project, relative)
		if err != nil {
			return err
		}
		if err := restore(cleanRoot(root), relative, file); err != nil {
			return err
		}
		delete(project.files, relative)
		return nil
	})
}

// AcceptAll tiene tutte le modifiche dell'agente.
func (t *Tracker) AcceptAll(root string) error {
	return t.update(root, func(project *projectReview) error {
		project.files = map[string]*pendingFile{}
		return nil
	})
}

// RejectAll riporta tutti i file com'erano prima dell'agente. Si ferma al primo errore: i file già
// ripristinati escono dalla review, gli altri restano.
func (t *Tracker) RejectAll(root string) error {
	return t.update(root, func(project *projectReview) error {
		paths := make([]string, 0, len(project.files))
		for relative := range project.files {
			paths = append(paths, relative)
		}
		sort.Strings(paths)
		for _, relative := range paths {
			if err := restore(cleanRoot(root), relative, project.files[relative]); err != nil {
				return err
			}
			delete(project.files, relative)
		}
		return nil
	})
}

// SetBaseline accetta una parte delle modifiche: il nuovo contenuto di partenza include i blocchi accettati.
func (t *Tracker) SetBaseline(root, relative, content string) error {
	return t.update(root, func(project *projectReview) error {
		file, err := pendingAt(project, relative)
		if err != nil {
			return err
		}
		if file.baseline == nil || !file.reviewable {
			return fmt.Errorf("%s can only be accepted or rejected as a whole", relative)
		}
		file.baseline = &content
		return nil
	})
}

// WriteCurrent rifiuta una parte delle modifiche scrivendo content su disco, solo se il file è ancora
// expected (quello che l'utente stava guardando): una modifica successiva non viene mai sovrascritta.
func (t *Tracker) WriteCurrent(root, relative, content, expected string) error {
	return t.update(root, func(project *projectReview) error {
		file, err := pendingAt(project, relative)
		if err != nil {
			return err
		}
		if file.baseline == nil || !file.reviewable {
			return fmt.Errorf("%s can only be accepted or rejected as a whole", relative)
		}
		path := filepath.Join(cleanRoot(root), filepath.FromSlash(relative))
		current, exists, readable := readCurrent(cleanRoot(root), relative)
		if !exists || !readable || current != expected {
			return ErrStale
		}
		return writeText(path, content)
	})
}

func (t *Tracker) update(root string, change func(*projectReview) error) error {
	root = cleanRoot(root)
	if root == "" {
		return errors.New("project folder is required")
	}
	t.mu.Lock()
	project := t.projects[root]
	if project == nil {
		t.mu.Unlock()
		return errors.New("there are no agent changes to review in this project")
	}
	err := change(project)
	t.pruneLocked(root, project)
	t.mu.Unlock()
	t.publish(root)
	return err
}

// pendingAt accetta solo i percorsi già in review: nessuna scrittura arbitraria dal renderer.
func pendingAt(project *projectReview, relative string) (*pendingFile, error) {
	file := project.files[relative]
	if file == nil {
		return nil, fmt.Errorf("%s is no longer waiting for review", relative)
	}
	return file, nil
}

func restore(root, relative string, file *pendingFile) error {
	path := filepath.Join(root, filepath.FromSlash(relative))
	if file.baseline == nil {
		if !file.reviewable {
			return fmt.Errorf("%s is binary or too large to restore: undo it with Git or Local History", relative)
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("could not delete %s: %w", relative, err)
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("could not recreate the folder of %s: %w", relative, err)
	}
	return writeText(path, *file.baseline)
}

func writeText(path, content string) error {
	mode := os.FileMode(0o644)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	return fileio.AtomicWriteFile(path, []byte(content), mode)
}

// readCurrent: contenuto attuale, se il file esiste e se è testo leggibile.
func readCurrent(root, relative string) (content string, exists, readable bool) {
	path := filepath.Join(root, filepath.FromSlash(relative))
	if _, err := os.Lstat(path); err != nil {
		return "", false, false
	}
	text, ok := readText(path)
	return text, true, ok
}

func (t *Tracker) setNotice(root, notice string) {
	t.mu.Lock()
	t.projectLocked(root).notice = notice
	t.mu.Unlock()
	t.publish(root)
}

func (t *Tracker) projectLocked(root string) *projectReview {
	project := t.projects[root]
	if project == nil {
		project = &projectReview{files: map[string]*pendingFile{}}
		t.projects[root] = project
	}
	return project
}

func (t *Tracker) publish(root string) {
	t.mu.Lock()
	emit := t.emit
	files := 0
	if project := t.projects[root]; project != nil {
		files = len(project.files)
	}
	t.mu.Unlock()
	if emit != nil {
		emit(ChangedEvent, ChangedPayload{Root: root, Files: files})
	}
}

func cleanRoot(root string) string {
	root = strings.TrimSpace(root)
	if root == "" {
		return ""
	}
	return filepath.Clean(root)
}
