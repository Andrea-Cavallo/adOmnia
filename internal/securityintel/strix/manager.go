package strix

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// Stati di una run.
const (
	StatePreparing = "preparing"
	StateRunning   = "running"
	StateFinished  = "finished" // exit 0: nessuna vulnerabilità
	StateFound     = "found"    // exit 2: vulnerabilità trovate
	StateFailed    = "failed"
	StateCancelled = "cancelled"
)

const (
	maxLogLines    = 3000
	maxLogLineSize = 2000
	runTimeout     = 6 * time.Hour
)

// Run è lo stato osservabile di una scansione.
type Run struct {
	ID         string    `json:"id"`
	Root       string    `json:"root"`
	Mode       string    `json:"mode"`
	State      string    `json:"state"`
	Error      string    `json:"error,omitempty"`
	StartedAt  time.Time `json:"startedAt"`
	FinishedAt time.Time `json:"finishedAt,omitzero"`
	ExitCode   int       `json:"exitCode"`
	Files      int       `json:"files"`
	// Offset è la posizione dell'ultima riga restituita da Output: la prossima chiamata riparte da qui.
	Offset int `json:"offset"`
	// Output sono le righe nuove dal `since` richiesto.
	Output []string `json:"output"`
}

type run struct {
	mu      sync.Mutex
	info    Run
	lines   []string
	dropped int
	dir     string
	cancel  context.CancelFunc
}

// Manager tiene le scansioni di questa sessione dell'app. I risultati restano su disco nella cartella dei dati.
type Manager struct {
	dataDir string
	binary  func() (string, error)
	mu      sync.Mutex
	runs    map[string]*run
}

// NewManager crea il manager; dataDir è la cartella dati di adOmnia (le run vanno sotto `strix/`).
func NewManager(dataDir string) *Manager {
	return &Manager{dataDir: filepath.Join(dataDir, "strix"), binary: FindBinary, runs: map[string]*run{}}
}

func newID() string {
	raw := make([]byte, 6)
	_, _ = rand.Read(raw)
	return time.Now().Format("20060102-150405") + "-" + hex.EncodeToString(raw)
}

// Start prepara la copia del progetto e lancia Strix in background. Torna subito con la run in `preparing`.
func (m *Manager) Start(options Options, llm LLM) (Run, error) {
	options, err := options.Validate()
	if err != nil {
		return Run{}, err
	}
	if llm.Model == "" {
		return Run{}, errors.New("no AI model configured for Strix")
	}
	binary, err := m.binary()
	if err != nil {
		return Run{}, err
	}
	id := newID()
	dir := filepath.Join(m.dataDir, id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return Run{}, fmt.Errorf("create the scan folder: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), runTimeout)
	r := &run{dir: dir, cancel: cancel, info: Run{ID: id, Root: options.Root, Mode: options.Mode, State: StatePreparing, StartedAt: time.Now()}}
	m.mu.Lock()
	m.runs[id] = r
	m.mu.Unlock()
	go m.execute(ctx, r, binary, options, llm)
	return r.snapshot(0), nil
}

func (m *Manager) execute(ctx context.Context, r *run, binary string, options Options, llm LLM) {
	defer r.cancel()
	copyDir := filepath.Join(r.dir, "project")
	r.log("Copying the project (your files are never modified)…")
	snapshot, err := CopyProject(ctx, options.Root, copyDir)
	if err != nil {
		r.finish(StateFailed, -1, err)
		return
	}
	r.mu.Lock()
	r.info.Files, r.info.State = snapshot.Files, StateRunning
	r.mu.Unlock()
	r.log(fmt.Sprintf("Scanning %d files in %s mode…", snapshot.Files, options.Mode))

	command := procutil.CommandContext(ctx, binary, options.Arguments(copyDir)...)
	command.Dir = r.dir
	command.Env = append(os.Environ(), llm.Environment()...)
	command.Cancel = func() error { return terminate(command) }
	reader, writer := io.Pipe()
	command.Stdout, command.Stderr = writer, writer
	done := make(chan struct{})
	go func() {
		defer close(done)
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 64*1024), 1<<20)
		for scanner.Scan() {
			r.log(clean(scanner.Text(), llm.APIKey))
		}
	}()
	err = command.Run()
	_ = writer.Close()
	<-done
	switch {
	case ctx.Err() != nil && errors.Is(ctx.Err(), context.Canceled):
		r.finish(StateCancelled, -1, nil)
	case err == nil:
		r.finish(StateFinished, 0, nil)
	default:
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 2 {
			r.finish(StateFound, 2, nil)
			return
		}
		code := -1
		if errors.As(err, &exit) {
			code = exit.ExitCode()
		}
		r.finish(StateFailed, code, fmt.Errorf("Strix stopped with an error (exit %d): see the output", code))
	}
}

// terminate chiude il processo; Strix lancia Docker, che si ferma quando Strix riceve la chiusura.
func terminate(command *exec.Cmd) error {
	if command.Process == nil {
		return nil
	}
	if runtime.GOOS == "windows" {
		return command.Process.Kill()
	}
	return command.Process.Signal(os.Interrupt)
}

// clean toglie sequenze ANSI e qualunque occorrenza della chiave API dall'output prima di mostrarlo o tenerlo.
func clean(line, secret string) string {
	line = ansi.ReplaceAllString(line, "")
	if secret != "" {
		line = strings.ReplaceAll(line, secret, "***")
	}
	if len(line) > maxLogLineSize {
		line = line[:maxLogLineSize] + "…"
	}
	return line
}

func (r *run) log(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lines = append(r.lines, line)
	if len(r.lines) > maxLogLines {
		drop := len(r.lines) - maxLogLines
		r.lines, r.dropped = r.lines[drop:], r.dropped+drop
	}
}

func (r *run) finish(state string, code int, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.info.State, r.info.ExitCode, r.info.FinishedAt = state, code, time.Now()
	if err != nil {
		r.info.Error = err.Error()
	}
}

// snapshot è la run con le righe di output successive a `since` (indice assoluto, anche dopo il troncamento).
func (r *run) snapshot(since int) Run {
	r.mu.Lock()
	defer r.mu.Unlock()
	info := r.info
	start := max(since-r.dropped, 0)
	if start > len(r.lines) {
		start = len(r.lines)
	}
	info.Output = append([]string(nil), r.lines[start:]...)
	info.Offset = r.dropped + len(r.lines)
	return info
}

func (m *Manager) find(id string) (*run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok {
		return nil, fmt.Errorf("unknown Strix run %q", id)
	}
	return r, nil
}

// Status restituisce lo stato e l'output nuovo dall'indice `since`.
func (m *Manager) Status(id string, since int) (Run, error) {
	r, err := m.find(id)
	if err != nil {
		return Run{}, err
	}
	return r.snapshot(since), nil
}

// Cancel ferma la scansione in corso.
func (m *Manager) Cancel(id string) error {
	r, err := m.find(id)
	if err != nil {
		return err
	}
	r.cancel()
	return nil
}

// Report legge i risultati della run (anche mentre gira: Strix scrive man mano).
func (m *Manager) Report(id string) (Report, error) {
	r, err := m.find(id)
	if err != nil {
		return Report{}, err
	}
	return LoadReport(r.dir)
}

// Export è il report completo in Markdown.
func (m *Manager) Export(id string) (string, error) {
	r, err := m.find(id)
	if err != nil {
		return "", err
	}
	report, err := LoadReport(r.dir)
	if err != nil {
		return "", err
	}
	r.mu.Lock()
	project := r.info.Root
	r.mu.Unlock()
	return report.ExportMarkdown(project), nil
}

// Install esegue il piano di installazione in background. L'output arriva con Status come per una scansione.
// Il consenso dell'utente al comando esatto è già stato dato dal chiamante.
func (m *Manager) Install(plan InstallPlan) (Run, error) {
	if plan.Program == "" {
		return Run{}, errors.New("no install plan")
	}
	id := newID()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	r := &run{cancel: cancel, info: Run{ID: id, Mode: "install", State: StateRunning, StartedAt: time.Now()}}
	m.mu.Lock()
	m.runs[id] = r
	m.mu.Unlock()
	go func() {
		defer cancel()
		r.log("$ " + plan.Command)
		command := procutil.CommandContext(ctx, plan.Program, plan.Args...)
		reader, writer := io.Pipe()
		command.Stdout, command.Stderr = writer, writer
		done := make(chan struct{})
		go func() {
			defer close(done)
			scanner := bufio.NewScanner(reader)
			for scanner.Scan() {
				r.log(clean(scanner.Text(), ""))
			}
		}()
		err := command.Run()
		_ = writer.Close()
		<-done
		if err != nil {
			r.finish(StateFailed, -1, fmt.Errorf("install failed: %w", err))
			return
		}
		r.finish(StateFinished, 0, nil)
	}()
	return r.snapshot(0), nil
}
