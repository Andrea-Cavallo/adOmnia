package codestudio

import (
	"context"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"adomnia/internal/ide/preview"
	"adomnia/internal/ide/project"
	"adomnia/internal/languages/web"
)

// Live Server: anteprima dei progetti web (HTML/CSS/JS statici, React/Vite, Node) dentro l'IDE.
// La logica vive in internal/ide/preview (server, dev server, processi) e internal/languages/web
// (riconoscimento di progetti, package manager, language server); qui c'è solo il collegamento
// alla sessione: fiducia, percorsi autorizzati, configurazione salvata ed eventi verso la UI.

const (
	// previewPortBase è l'inizio dell'intervallo da cui i siti statici scelgono una porta stabile per progetto.
	previewPortBase  = 5500
	previewPortRange = 400
	// webTargetsTimeout limita la scansione dei package.json di progetti enormi.
	webTargetsTimeout = 10 * time.Second
)

// Alias dei tipi esposti ai binding: la UI importa tutto da goide.
type (
	Preview       = preview.Preview
	WebServerInfo = web.ServerInfo
)

// Modalità di anteprima richieste dalla UI.
const (
	PreviewModeStatic    = string(preview.ModeStatic)
	PreviewModeDevServer = string(preview.ModeDevServer)
)

// PreviewConfig è l'ultima configurazione di Live Preview di un progetto: riaprendo la cartella
// l'IDE riparte da qui. Non contiene segreti.
type PreviewConfig struct {
	Mode string `json:"mode,omitempty"`
	// Dir è la cartella del sito o dell'app, relativa al progetto e con barre normali ("." = radice).
	Dir string `json:"dir,omitempty"`
	// Script è lo script del package.json che avvia il dev server (vuoto = quello rilevato).
	Script string `json:"script,omitempty"`
	// Entry è la pagina HTML da aprire per il sito statico, relativa a Dir.
	Entry string `json:"entry,omitempty"`
	// SPA serve index.html per i percorsi che non esistono (router lato client) nel sito statico.
	SPA bool `json:"spa,omitempty"`
	// Placement è dove mostrare l'anteprima: "tab", "split", "panel" o "window".
	Placement  string `json:"placement,omitempty"`
	Device     string `json:"device,omitempty"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	AutoReload bool   `json:"autoReload"`
}

// previewConfigStore conserva le configurazioni per cartella del progetto.
type previewConfigStore struct {
	mu      sync.RWMutex
	configs map[string]PreviewConfig
}

func configKey(realPath string) string {
	key := filepath.Clean(realPath)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		key = strings.ToLower(key)
	}
	return key
}

func (c *previewConfigStore) replace(configs map[string]PreviewConfig) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.configs = make(map[string]PreviewConfig, len(configs))
	for key, config := range configs {
		c.configs[key] = config
	}
}

func (c *previewConfigStore) snapshot() map[string]PreviewConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.configs) == 0 {
		return nil
	}
	clone := make(map[string]PreviewConfig, len(c.configs))
	for key, config := range c.configs {
		clone[key] = config
	}
	return clone
}

func (c *previewConfigStore) get(realPath string) (PreviewConfig, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	config, ok := c.configs[configKey(realPath)]
	return config, ok
}

func (c *previewConfigStore) set(realPath string, config PreviewConfig) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.configs == nil {
		c.configs = map[string]PreviewConfig{}
	}
	c.configs[configKey(realPath)] = config
}

// WebProjectReport è ciò che la UI mostra prima di avviare un'anteprima: progetti rilevati,
// runtime, language server e stato delle anteprime. Rilevare non esegue nulla.
type WebProjectReport struct {
	Targets []web.Info `json:"targets"`
	// Runtime è quello del progetto predefinito (Node.js e il suo package manager).
	Runtime  web.Runtime       `json:"runtime"`
	Servers  []web.ServerInfo  `json:"servers"`
	Config   *PreviewConfig    `json:"config,omitempty"`
	Previews []preview.Preview `json:"previews"`
	// Trusted dice se la sessione può avviare processi: senza fiducia l'anteprima non parte.
	Trusted bool `json:"trusted"`
}

// DetectWebProject riconosce i progetti web della sessione (package.json, siti statici), il
// runtime Node.js e i language server disponibili. Non avvia e non installa nulla.
func (s *Service) DetectWebProject(sessionID string) (WebProjectReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return WebProjectReport{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), webTargetsTimeout)
	defer cancel()
	targets, err := web.Targets(ctx, session.Project.RealPath)
	if err != nil {
		return WebProjectReport{}, fmt.Errorf("could not scan the project: %w", err)
	}
	report := WebProjectReport{
		Targets: targets, Servers: s.webServers(session), Previews: s.previews.List(sessionID),
		Trusted: session.Project.Authorization == AuthorizationPermitted,
	}
	if config, ok := s.previewConfigs.get(session.Project.RealPath); ok {
		report.Config = &config
	}
	report.Runtime = web.DetectRuntime(defaultPackageManager(targets, report.Config))
	return report, nil
}

// defaultPackageManager sceglie il package manager del progetto che l'IDE proporrà per primo.
func defaultPackageManager(targets []web.Info, config *PreviewConfig) string {
	for _, target := range targets {
		if config != nil && target.Relative == config.Dir && target.PackageManager != "" {
			return target.PackageManager
		}
	}
	for _, target := range targets {
		if target.DevScript != "" {
			return target.PackageManager
		}
	}
	return web.NPM
}

// PreviewRequest chiede un'anteprima.
type PreviewRequest struct {
	Mode   string `json:"mode"`
	Dir    string `json:"dir"`
	Script string `json:"script,omitempty"`
	Entry  string `json:"entry,omitempty"`
	SPA    bool   `json:"spa,omitempty"`
}

// StartPreview avvia l'anteprima richiesta per un progetto autorizzato e ne ricorda la configurazione.
// Un problema prevedibile (Node.js mancante, dipendenze da installare) non è un errore: torna come
// anteprima "failed" con la spiegazione, mostrata nel pannello come ogni altro stato.
func (s *Service) StartPreview(sessionID string, request PreviewRequest) (preview.Preview, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return preview.Preview{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return preview.Preview{}, fmt.Errorf("trust the project before starting a preview: it runs the project's own code")
	}
	dir, relative, err := resolveProjectDir(session.Project.RealPath, request.Dir)
	if err != nil {
		return preview.Preview{}, err
	}
	var started preview.Preview
	switch request.Mode {
	case PreviewModeStatic:
		started, err = s.startStaticPreview(session, dir, relative, request)
	case PreviewModeDevServer:
		started, err = s.startDevServerPreview(session, dir, relative, request)
	default:
		return preview.Preview{}, fmt.Errorf("unknown preview mode %q", request.Mode)
	}
	if err != nil {
		return started, err
	}
	s.rememberPreview(session, request, relative)
	return started, nil
}

func (s *Service) startStaticPreview(session Session, dir, relative string, request PreviewRequest) (preview.Preview, error) {
	entry, err := staticEntry(dir, request.Entry)
	if err != nil {
		return preview.Preview{}, err
	}
	return s.previews.StartStatic(preview.StaticRequest{
		ID: "static:" + relative, SessionID: string(session.ID), Label: filepath.Base(dir), Entry: entry,
		Options: preview.StaticOptions{Root: dir, PreferredPort: stablePort(dir), SPAFallback: request.SPA},
	})
}

// staticEntry controlla che la pagina di ingresso esista dentro la cartella servita.
func staticEntry(dir, entry string) (string, error) {
	entry = strings.Trim(filepath.ToSlash(entry), "/")
	if entry == "" || entry == "index.html" {
		return "", nil
	}
	if err := project.EnsureWithin(dir, filepath.Join(dir, filepath.FromSlash(entry))); err != nil {
		return "", fmt.Errorf("the page %q is outside the served folder", entry)
	}
	if info, err := os.Stat(filepath.Join(dir, filepath.FromSlash(entry))); err != nil || info.IsDir() {
		return "", fmt.Errorf("the page %q does not exist", entry)
	}
	return entry, nil
}

// stablePort deriva una porta preferita dal percorso: stessa cartella, stessa porta, così
// localStorage e cookie del sito sopravvivono ai riavvii.
func stablePort(dir string) int {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(configKey(dir)))
	return previewPortBase + int(hash.Sum32()%previewPortRange)
}

func (s *Service) startDevServerPreview(session Session, dir, relative string, request PreviewRequest) (preview.Preview, error) {
	info, err := web.Inspect(session.Project.RealPath, dir)
	if err != nil {
		return preview.Preview{}, err
	}
	script := request.Script
	if script == "" {
		script = info.DevScript
	}
	id := "dev:" + relative + ":" + script
	base := preview.Preview{ID: id, SessionID: string(session.ID), Mode: preview.ModeDevServer, Root: dir, Label: filepath.Base(dir)}
	if info.Kind != web.UnitNode || strings.TrimSpace(info.Scripts[script]) == "" {
		base.FailureKind, base.Error = "no-script", fmt.Sprintf("This folder has no %q script in its package.json. Pick another script, or serve it as a static site.", script)
		return s.previews.Report(base), nil
	}
	runtimeInfo := web.DetectRuntime(info.PackageManager)
	if !runtimeInfo.Ready() {
		base.FailureKind, base.Error, base.Hints = "runtime", runtimeInfo.Problem, runtimeInfo.Remedies
		return s.previews.Report(base), nil
	}
	if !info.DependenciesInstalled {
		base.FailureKind = preview.FailureMissingDeps
		base.Error = "The project dependencies are not installed. Install them first: adOmnia asks for confirmation before running the install."
		return s.previews.Report(base), nil
	}
	port, err := preview.FreePort(web.DefaultPort(info.Tool))
	if err != nil {
		return preview.Preview{}, err
	}
	arguments := web.RunScriptArguments(info.PackageManager, script, web.DevServerArguments(info))
	spec := CommandSpec{
		SessionID: session.ID, Kind: "devserver", Executable: runtimeInfo.PackageManagerBinary, Arguments: arguments,
		WorkingDirectory: dir, Environment: environmentWith(web.DevServerEnvironment(info, port)),
		DisplayCommand: displayCommand(info.PackageManager, arguments),
	}
	return s.previews.StartDevServer(preview.DevServerRequest{ID: id, SessionID: string(session.ID), Label: script + " · " + filepath.Base(dir), ProxyPort: stablePort(dir), Spec: spec})
}

// environmentWith restituisce l'ambiente del processo con le variabili aggiunte (le ultime vincono).
func environmentWith(extra map[string]string) []string {
	environment := os.Environ()
	for name, value := range extra {
		environment = append(environment, name+"="+value)
	}
	return environment
}

// resolveProjectDir traduce una cartella relativa del progetto in un percorso reale dentro di esso:
// rifiuta "..", percorsi assoluti e link simbolici che escono dal progetto.
func resolveProjectDir(root, requested string) (dir, relative string, err error) {
	requested = strings.Trim(filepath.ToSlash(strings.TrimSpace(requested)), "/")
	if requested == "" {
		requested = "."
	}
	if filepath.IsAbs(requested) || strings.Contains(requested, "..") {
		return "", "", fmt.Errorf("the folder must be inside the project")
	}
	candidate := filepath.Join(root, filepath.FromSlash(requested))
	real, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", "", fmt.Errorf("the folder %q does not exist", requested)
	}
	if err := project.EnsureWithin(root, real); err != nil {
		return "", "", fmt.Errorf("the folder must be inside the project")
	}
	return real, requested, nil
}

func (s *Service) rememberPreview(session Session, request PreviewRequest, relative string) {
	config, _ := s.previewConfigs.get(session.Project.RealPath)
	config.Mode, config.Dir, config.Script, config.Entry, config.SPA = request.Mode, relative, request.Script, request.Entry, request.SPA
	s.previewConfigs.set(session.Project.RealPath, config)
	_ = s.saveState()
}

// GetPreviewConfig restituisce l'ultima configurazione salvata del progetto.
func (s *Service) GetPreviewConfig(sessionID string) (*PreviewConfig, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	config, ok := s.previewConfigs.get(session.Project.RealPath)
	if !ok {
		return nil, nil
	}
	return &config, nil
}

// SavePreviewConfig salva le preferenze di visualizzazione (posizione, viewport, auto reload) senza
// toccare cosa avviare: mode, cartella, script e pagina cambiano solo con StartPreview.
func (s *Service) SavePreviewConfig(sessionID string, config PreviewConfig) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	if config.Placement != "" && !slices.Contains([]string{"panel", "split", "tab", "window"}, config.Placement) {
		return fmt.Errorf("unknown preview placement %q", config.Placement)
	}
	if config.Device != "" && !slices.Contains([]string{"desktop", "tablet", "mobile", "custom"}, config.Device) {
		return fmt.Errorf("unknown preview device %q", config.Device)
	}
	current, _ := s.previewConfigs.get(session.Project.RealPath)
	current.Placement, current.Device = config.Placement, config.Device
	current.Width, current.Height = clampViewport(config.Width), clampViewport(config.Height)
	current.AutoReload = config.AutoReload
	s.previewConfigs.set(session.Project.RealPath, current)
	return s.saveState()
}

func clampViewport(value int) int {
	if value < 0 {
		return 0
	}
	return min(value, 10_000)
}

// StopPreview ferma un'anteprima e libera la sua porta e i suoi processi.
func (s *Service) StopPreview(sessionID, previewID string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	return s.previews.Stop(sessionID, previewID)
}

// ListPreviews restituisce le anteprime della sessione, anche ferme o fallite.
func (s *Service) ListPreviews(sessionID string) ([]preview.Preview, error) {
	if _, err := s.session(sessionID); err != nil {
		return nil, err
	}
	return s.previews.List(sessionID), nil
}

// DismissPreviews dimentica le anteprime ferme o fallite già mostrate.
func (s *Service) DismissPreviews(sessionID string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	s.previews.Forget(sessionID)
	return nil
}

// ReadyPreviewURL restituisce l'URL di un'anteprima pronta della sessione: è l'unico indirizzo che
// l'IDE apre in una finestra nativa o nel browser esterno, mai un URL scelto dal chiamante.
func (s *Service) ReadyPreviewURL(sessionID, previewID string) (string, error) {
	if _, err := s.session(sessionID); err != nil {
		return "", err
	}
	current, ok := s.previews.Get(sessionID, previewID)
	if !ok || current.State != preview.StateReady || current.URL == "" {
		return "", fmt.Errorf("the preview is not running")
	}
	// Browser esterno e finestra nativa aprono il server vero, senza il proxy del bridge.
	address := current.DirectURL
	if address == "" {
		address = current.URL
	}
	return strings.TrimRight(address, "/") + "/" + strings.TrimLeft(current.Entry, "/"), nil
}

func (s *Service) previewChanged(current preview.Preview) {
	s.emit("preview.status", SessionID(current.SessionID), current.ID, current)
}

// notifyPreviews inoltra le modifiche su disco ai siti statici in ascolto.
func (s *Service) notifyPreviews(sessionID SessionID, batch FilesChanged) {
	if batch.Overflow {
		s.previews.ReloadSession(string(sessionID))
		return
	}
	paths := make([]string, 0, len(batch.Changes))
	for _, change := range batch.Changes {
		paths = append(paths, change.Path)
	}
	s.previews.NotifyChanges(string(sessionID), paths)
}

// InstallWebDependencies installa le dipendenze di un progetto con il suo package manager, solo
// dopo conferma esplicita. Con un lockfile usa la variante "congelata": non lo riscrive.
func (s *Service) InstallWebDependencies(sessionID, dir string, confirmed bool) (Execution, error) {
	if !confirmed {
		return Execution{}, fmt.Errorf("explicit confirmation required before installing dependencies")
	}
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("trust the project before installing its dependencies")
	}
	resolved, _, err := resolveProjectDir(session.Project.RealPath, dir)
	if err != nil {
		return Execution{}, err
	}
	info, err := web.Inspect(session.Project.RealPath, resolved)
	if err != nil {
		return Execution{}, err
	}
	if info.Kind != web.UnitNode {
		return Execution{}, fmt.Errorf("this folder has no package.json")
	}
	runtimeInfo := web.DetectRuntime(info.PackageManager)
	if !runtimeInfo.Ready() {
		return Execution{}, fmt.Errorf("%s", runtimeInfo.Problem)
	}
	arguments := web.InstallArguments(info)
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "install", Executable: runtimeInfo.PackageManagerBinary, Arguments: arguments,
		WorkingDirectory: resolved, Environment: os.Environ(), DisplayCommand: displayCommand(info.PackageManager, arguments),
	})
}

// webServers elenca i language server web con la loro disponibilità per la sessione.
func (s *Service) webServers(session Session) []web.ServerInfo {
	servers := make([]web.ServerInfo, 0, len(web.ServerLanguages()))
	for _, languageID := range web.ServerLanguages() {
		servers = append(servers, web.LocateServer(languageID, session.Project.RealPath, "", s.toolsRoot))
	}
	return servers
}

// WebLanguageServers restituisce la disponibilità dei language server web.
func (s *Service) WebLanguageServers(sessionID string) ([]web.ServerInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	return s.webServers(session), nil
}

// StartWebLanguageServer avvia il language server del linguaggio web per un progetto autorizzato.
// Se non è installato l'errore lo dice: l'editor continua con le funzioni di Monaco.
func (s *Service) StartWebLanguageServer(sessionID, languageID string) (LanguageServerStatus, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return LanguageServerStatus{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return LanguageServerStatus{}, fmt.Errorf("trust the project before starting a language server")
	}
	info := web.LocateServer(languageID, session.Project.RealPath, "", s.toolsRoot)
	spec, err := web.ServerSpec(info)
	if err != nil {
		return LanguageServerStatus{}, err
	}
	s.trackLanguageDocuments(session, languageID)
	return s.lsp.Start(session, spec)
}

// StopWebLanguageServer ferma il language server web della sessione.
func (s *Service) StopWebLanguageServer(sessionID, languageID string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	s.lsp.Stop(SessionID(sessionID), languageID)
	return nil
}

// WebLanguageServerStatus restituisce lo stato del language server web.
func (s *Service) WebLanguageServerStatus(sessionID, languageID string) (LanguageServerStatus, error) {
	if _, err := s.session(sessionID); err != nil {
		return LanguageServerStatus{}, err
	}
	return s.lsp.Status(SessionID(sessionID), languageID), nil
}

// InstallWebTools installa i language server web nella cartella strumenti di adOmnia (mai nel
// progetto), dopo conferma esplicita. Il comando è visibile nella console Run.
func (s *Service) InstallWebTools(sessionID string, confirmed bool) (Execution, error) {
	if !confirmed {
		return Execution{}, fmt.Errorf("explicit confirmation required before downloading the tools")
	}
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("trust the project before installing tools")
	}
	if s.toolsRoot == "" {
		return Execution{}, fmt.Errorf("adOmnia tools folder not configured")
	}
	runtimeInfo := web.DetectRuntime(web.NPM)
	if !runtimeInfo.Ready() {
		return Execution{}, fmt.Errorf("%s: npm is needed to install the web language servers", runtimeInfo.Problem)
	}
	prefix := web.ManagedPrefix(s.toolsRoot)
	if err := os.MkdirAll(prefix, 0o755); err != nil {
		return Execution{}, fmt.Errorf("could not prepare the tools folder: %w", err)
	}
	arguments := append([]string{"install", "--no-audit", "--no-fund", "--prefix", prefix}, web.ManagedPackages...)
	return s.processes.Start(CommandSpec{
		SessionID: session.ID, Kind: "install", Executable: runtimeInfo.PackageManagerBinary, Arguments: arguments,
		WorkingDirectory: prefix, Environment: os.Environ(), DisplayCommand: displayCommand("npm", arguments),
	})
}
