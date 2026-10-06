package golang

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	goversion "go/version"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"adomnia/internal/ide/project"
	"adomnia/internal/ide/sdk"
	"adomnia/internal/netpolicy"
)

const (
	goDownloadIndexURL  = "https://go.dev/dl/?mode=json&include=all"
	maxDownloadIndex    = 4 * 1024 * 1024
	maxToolchainArchive = 350 * 1024 * 1024
)

type ToolchainRelease struct {
	Version  string `json:"version"`
	Filename string `json:"filename"`
	SHA256   string `json:"sha256"`
	Size     int64  `json:"size"`
	Stable   bool   `json:"stable"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
}

type InstalledToolchain struct {
	Version  string `json:"version"`
	GoBinary string `json:"goBinary"`
}

type InstallToolchainRequest struct {
	SessionID string `json:"sessionId"`
	Version   string `json:"version"`
	Confirmed bool   `json:"confirmed"`
	Activate  bool   `json:"activate"`
}

type ToolchainInstallation struct {
	ID              string   `json:"id"`
	SessionID       string   `json:"sessionId"`
	Version         string   `json:"version"`
	Status          string   `json:"status"`
	DownloadedBytes int64    `json:"downloadedBytes"`
	TotalBytes      int64    `json:"totalBytes"`
	Message         string   `json:"message,omitempty"`
	GoBinary        string   `json:"goBinary,omitempty"`
	Log             []string `json:"log"`
}

type goDownloadRelease struct {
	Version string           `json:"version"`
	Stable  bool             `json:"stable"`
	Files   []goDownloadFile `json:"files"`
}

type goDownloadFile struct {
	Filename string `json:"filename"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
	SHA256   string `json:"sha256"`
	Size     int64  `json:"size"`
	Kind     string `json:"kind"`
}

type installOperation struct {
	state  ToolchainInstallation
	cancel context.CancelFunc
	done   chan struct{}
}

type ToolchainInstaller struct {
	mu         sync.RWMutex
	root       string
	operations map[string]*installOperation
	emit       func(string, ToolchainInstallation)
}

// NewToolchainInstaller crea il gestore locale senza effettuare accessi di rete.
func NewToolchainInstaller(emit func(string, ToolchainInstallation)) *ToolchainInstaller {
	return &ToolchainInstaller{
		operations: make(map[string]*installOperation),
		emit:       emit,
	}
}

// ConfigureRoot imposta la cartella locale dedicata alle toolchain gestite da adOmnia.
func (i *ToolchainInstaller) ConfigureRoot(root string) error {
	abs, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return fmt.Errorf("cartella toolchain non valida: %w", err)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return fmt.Errorf("impossibile preparare la cartella toolchain: %w", err)
	}
	i.mu.Lock()
	i.root = abs
	i.mu.Unlock()
	return nil
}

// ListReleases legge il catalogo ufficiale Go e restituisce gli archivi compatibili con la piattaforma corrente.
func (i *ToolchainInstaller) ListReleases(ctx context.Context) ([]ToolchainRelease, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, goDownloadIndexURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := toolchainDownloadClient().Do(request)
	if err != nil {
		return nil, fmt.Errorf("catalogo Go non raggiungibile: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("catalogo Go: risposta HTTP %d", response.StatusCode)
	}
	var releases []goDownloadRelease
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxDownloadIndex))
	if err := decoder.Decode(&releases); err != nil {
		return nil, fmt.Errorf("catalogo Go non valido: %w", err)
	}
	result := make([]ToolchainRelease, 0, 20)
	for _, release := range releases {
		for _, file := range release.Files {
			if file.OS != runtime.GOOS || file.Arch != runtime.GOARCH || file.Kind != "archive" {
				continue
			}
			result = append(result, ToolchainRelease{Version: release.Version, Filename: file.Filename, SHA256: file.SHA256, Size: file.Size, Stable: release.Stable, OS: file.OS, Arch: file.Arch})
			break
		}
	}
	sort.Slice(result, func(left, right int) bool { return newerGoVersion(result[left].Version, result[right].Version) })
	if len(result) > 30 {
		result = result[:30]
	}
	return result, nil
}

// ListInstalled restituisce le versioni Go isolate già disponibili localmente.
func (i *ToolchainInstaller) ListInstalled() ([]InstalledToolchain, error) {
	root, err := i.configuredRoot()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	result := make([]InstalledToolchain, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !validGoVersion(entry.Name()) {
			continue
		}
		binary := filepath.Join(root, entry.Name(), "go", "bin", GoExecutableName())
		if info, statErr := os.Stat(binary); statErr == nil && !info.IsDir() {
			result = append(result, InstalledToolchain{Version: entry.Name(), GoBinary: binary})
		}
	}
	sort.Slice(result, func(left, right int) bool { return newerGoVersion(result[left].Version, result[right].Version) })
	return result, nil
}

func newerGoVersion(left, right string) bool { return goversion.Compare(left, right) > 0 }

// Start avvia download, verifica ed estrazione senza bloccare il chiamante.
func (i *ToolchainInstaller) Start(request InstallToolchainRequest, release ToolchainRelease, completed func(string, error)) (ToolchainInstallation, error) {
	if !request.Confirmed {
		return ToolchainInstallation{}, fmt.Errorf("conferma esplicita richiesta prima del download")
	}
	if !validGoVersion(release.Version) || request.Version != release.Version {
		return ToolchainInstallation{}, fmt.Errorf("versione Go non valida")
	}
	if filepath.Base(release.Filename) != release.Filename || release.SHA256 == "" {
		return ToolchainInstallation{}, fmt.Errorf("metadati archivio Go non validi")
	}
	root, err := i.configuredRoot()
	if err != nil {
		return ToolchainInstallation{}, err
	}
	if _, err := os.Stat(filepath.Join(root, release.Version)); err == nil {
		return ToolchainInstallation{}, fmt.Errorf("%s è già installata", release.Version)
	} else if !os.IsNotExist(err) {
		return ToolchainInstallation{}, fmt.Errorf("impossibile verificare la versione installata: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	state := ToolchainInstallation{ID: newInstallID(), SessionID: request.SessionID, Version: release.Version, Status: "downloading", TotalBytes: release.Size, Message: "Download dall'archivio ufficiale Go", Log: []string{"Download avviato da https://go.dev/dl/" + release.Filename}}
	i.mu.Lock()
	if len(i.operations) >= 50 {
		for operationID, operation := range i.operations {
			if operation.state.Status != "downloading" && operation.state.Status != "extracting" {
				delete(i.operations, operationID)
			}
			if len(i.operations) < 40 {
				break
			}
		}
	}
	for _, operation := range i.operations {
		if operation.state.Status == "downloading" || operation.state.Status == "extracting" {
			i.mu.Unlock()
			cancel()
			return ToolchainInstallation{}, fmt.Errorf("un'installazione Go è già in corso")
		}
	}
	i.operations[state.ID] = &installOperation{state: state, cancel: cancel, done: make(chan struct{})}
	i.mu.Unlock()
	i.publish("toolchain.install.progress", state)
	go i.run(ctx, state.ID, release, completed)
	return state, nil
}

// Cancel annulla un'installazione in corso e rimuove i file temporanei.
func (i *ToolchainInstaller) Cancel(id string) error {
	i.mu.RLock()
	operation := i.operations[id]
	i.mu.RUnlock()
	if operation == nil {
		return fmt.Errorf("installazione Go non trovata")
	}
	operation.cancel()
	return nil
}

// Remove elimina una singola toolchain gestita dopo conferma esplicita.
func (i *ToolchainInstaller) Remove(version string, confirmed bool) error {
	if !confirmed {
		return fmt.Errorf("conferma esplicita richiesta prima della rimozione")
	}
	root, err := i.configuredRoot()
	if err != nil {
		return err
	}
	if !validGoVersion(version) {
		return fmt.Errorf("versione Go non valida")
	}
	target := filepath.Join(root, version)
	if err := project.EnsureWithin(root, target); err != nil {
		return err
	}
	return os.RemoveAll(target)
}

// Shutdown annulla e attende brevemente tutte le installazioni possedute.
func (i *ToolchainInstaller) Shutdown() {
	i.mu.RLock()
	operations := make([]*installOperation, 0, len(i.operations))
	for _, operation := range i.operations {
		if operation.state.Status == "downloading" || operation.state.Status == "extracting" {
			operations = append(operations, operation)
		}
	}
	i.mu.RUnlock()
	for _, operation := range operations {
		operation.cancel()
	}
	for _, operation := range operations {
		select {
		case <-operation.done:
		case <-time.After(5 * time.Second):
		}
	}
}

func (i *ToolchainInstaller) run(ctx context.Context, id string, release ToolchainRelease, completed func(string, error)) {
	i.mu.RLock()
	operation := i.operations[id]
	i.mu.RUnlock()
	if operation != nil {
		defer close(operation.done)
	}
	root, _ := i.configuredRoot()
	temporary, err := os.MkdirTemp(root, ".install-*")
	if err != nil {
		i.finish(id, "failed", "Preparazione installazione fallita", "", err)
		completed("", err)
		return
	}
	defer os.RemoveAll(temporary)
	archivePath := filepath.Join(temporary, release.Filename)
	if err = i.download(ctx, id, release, archivePath); err != nil {
		status := "failed"
		if ctx.Err() != nil {
			status = "cancelled"
		}
		i.finish(id, status, err.Error(), "", err)
		completed("", err)
		return
	}
	i.update(id, func(state *ToolchainInstallation) {
		state.Status = "extracting"
		state.Message = "Checksum verificato · estrazione in corso"
		state.Log = appendInstallLog(state.Log, "Checksum SHA-256 verificato", "Estrazione nell'archivio locale adOmnia")
	})
	extractRoot := filepath.Join(temporary, "extracted")
	if err = sdk.ExtractArchive(ctx, "Go", archivePath, extractRoot, maxToolchainArchive); err != nil {
		status := "failed"
		if errors.Is(err, context.Canceled) {
			status = "cancelled"
		}
		i.finish(id, status, err.Error(), "", err)
		completed("", err)
		return
	}
	if ctx.Err() != nil {
		err = ctx.Err()
		i.finish(id, "cancelled", "Installazione annullata", "", err)
		completed("", err)
		return
	}
	target := filepath.Join(root, release.Version)
	if err = project.EnsureWithin(root, target); err != nil {
		i.finish(id, "failed", err.Error(), "", err)
		completed("", err)
		return
	}
	binary := filepath.Join(extractRoot, "go", "bin", GoExecutableName())
	if info, statErr := os.Stat(binary); statErr != nil || info.IsDir() {
		err = fmt.Errorf("l'archivio non contiene un binario Go valido")
		i.finish(id, "failed", err.Error(), "", err)
		completed("", err)
		return
	}
	if err = os.Rename(extractRoot, target); err != nil {
		i.finish(id, "failed", "Attivazione installazione fallita", "", err)
		completed("", err)
		return
	}
	binary = filepath.Join(target, "go", "bin", GoExecutableName())
	completed(binary, nil)
	i.finish(id, "installed", "Installazione completata", binary, nil)
}

func (i *ToolchainInstaller) download(ctx context.Context, id string, release ToolchainRelease, destination string) error {
	if release.Size > maxToolchainArchive {
		return fmt.Errorf("archivio Go oltre il limite consentito")
	}
	return sdk.Download(ctx, toolchainDownloadClient(), "Go", "https://go.dev/dl/"+release.Filename, destination, release.SHA256, maxToolchainArchive, func(bytes int64) {
		i.update(id, func(state *ToolchainInstallation) { state.DownloadedBytes = bytes })
	})
}

func (i *ToolchainInstaller) update(id string, mutate func(*ToolchainInstallation)) {
	i.mu.Lock()
	operation := i.operations[id]
	if operation == nil {
		i.mu.Unlock()
		return
	}
	mutate(&operation.state)
	state := operation.state
	i.mu.Unlock()
	i.publish("toolchain.install.progress", state)
}

func (i *ToolchainInstaller) finish(id, status, message, binary string, _ error) {
	i.update(id, func(state *ToolchainInstallation) {
		state.Status = status
		state.Message = message
		state.GoBinary = binary
		state.Log = appendInstallLog(state.Log, message)
	})
}

func appendInstallLog(log []string, messages ...string) []string {
	log = append(log, messages...)
	if len(log) > 20 {
		log = log[len(log)-20:]
	}
	return log
}

func (i *ToolchainInstaller) publish(event string, state ToolchainInstallation) {
	if i.emit != nil {
		i.emit(event, state)
	}
}

func (i *ToolchainInstaller) configuredRoot() (string, error) {
	i.mu.RLock()
	root := i.root
	i.mu.RUnlock()
	if root == "" {
		return "", fmt.Errorf("archivio toolchain non configurato")
	}
	return root, nil
}

func validGoVersion(version string) bool {
	if !strings.HasPrefix(version, "go1.") || len(version) > 32 {
		return false
	}
	for _, character := range version[2:] {
		if (character < '0' || character > '9') && character != '.' && character != 'b' && character != 'e' && character != 't' && character != 'a' && character != 'r' && character != 'c' {
			return false
		}
	}
	return true
}

func GoExecutableName() string {
	if runtime.GOOS == "windows" {
		return "go.exe"
	}
	return "go"
}

func extractToolchainArchive(archivePath, destination string) error {
	return sdk.ExtractArchive(context.Background(), "Go", archivePath, destination, maxToolchainArchive)
}

func newInstallID() string {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return fmt.Sprintf("install-%d", time.Now().UnixNano())
	}
	return "install-" + hex.EncodeToString(random)
}

// toolchainDownloadClient segue proxy, CA e modo offline di adOmnia e accetta redirect solo verso go.dev.
func toolchainDownloadClient() *http.Client {
	client := netpolicy.Client("go-toolchain", 30*time.Minute)
	client.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		host := strings.ToLower(request.URL.Hostname())
		if host != "go.dev" && host != "dl.google.com" {
			return fmt.Errorf("redirect download non consentito: %s", host)
		}
		if len(via) > 5 {
			return fmt.Errorf("troppi redirect download")
		}
		return nil
	}
	return client
}
