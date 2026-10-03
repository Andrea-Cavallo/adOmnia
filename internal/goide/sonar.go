package goide

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"adomnia/internal/netpolicy"
)

// SonarQube è un'integrazione opzionale: adOmnia non installa né avvia nulla da sé. Con un server
// configurato, l'utente avvia la scansione (processo autorizzato) e adOmnia importa gli issue
// tramite la Web API, li mappa sul codice e li mostra nel Performance Studio. Il token resta in
// memoria per la sessione e non viene mai rispedito al frontend.

const (
	sonarScanner    = "sonar-scanner"
	sonarTimeout    = 15 * time.Minute
	sonarAPITimeout = 30 * time.Second
	sonarPageSize   = 500
	sonarMaxIssues  = 5_000
	// Elasticsearch rifiuta p*ps oltre 10.000: restiamo sotto con 5.000 issue.
	sonarMaxPages     = sonarMaxIssues / sonarPageSize
	sonarTaskTimeout  = 3 * time.Minute
	sonarTaskPoll     = 2 * time.Second
	sonarMaxOutput    = 32 * 1024
	sonarBaselineFile = ".adomnia/sonar-baseline.json"
	sonarBaselineFmt  = "adomnia-sonar-baseline"
	sonarBaselineVrs  = 1
)

var sonarVersionPattern = regexp.MustCompile(`(\d+\.\d+(?:\.\d+){0,2})`)

// SonarConfig è la configurazione non segreta di una sessione (il token non è mai qui).
type SonarConfig struct {
	Enabled    bool   `json:"enabled"`
	ServerURL  string `json:"serverUrl,omitempty"`
	ProjectKey string `json:"projectKey,omitempty"`
	Sources    string `json:"sources,omitempty"`
	Exclusions string `json:"exclusions,omitempty"`
	HasToken   bool   `json:"hasToken"`
}

// SonarScannerInfo descrive il sonar-scanner disponibile per la sessione.
type SonarScannerInfo struct {
	Available bool   `json:"available"`
	Binary    string `json:"binary,omitempty"`
	Version   string `json:"version,omitempty"`
	Source    string `json:"source,omitempty"`
	Error     string `json:"error,omitempty"`
}

// SonarIssue è un problema importato dalla Web API di SonarQube, già risolto sul file del progetto.
type SonarIssue struct {
	Key      string   `json:"key"`
	Rule     string   `json:"rule"`
	Severity string   `json:"severity,omitempty"`
	Type     string   `json:"type,omitempty"`
	Message  string   `json:"message"`
	File     string   `json:"file"`
	Line     int      `json:"line,omitempty"`
	Effort   string   `json:"effort,omitempty"`
	Status   string   `json:"status,omitempty"`
	Tags     []string `json:"tags,omitempty"`
}

// SonarScanResult è l'esito di una scansione e/o dell'importazione degli issue.
type SonarScanResult struct {
	ServerURL  string         `json:"serverUrl"`
	ProjectKey string         `json:"projectKey"`
	Issues     []SonarIssue   `json:"issues"`
	IssueCount int            `json:"issueCount"`
	Baselined  int            `json:"baselined,omitempty"`
	BySeverity map[string]int `json:"bySeverity,omitempty"`
	ByType     map[string]int `json:"byType,omitempty"`
	DurationMS int64          `json:"durationMs"`
	Output     string         `json:"output,omitempty"`
	Warning    string         `json:"warning,omitempty"`
	ScannedAt  time.Time      `json:"scannedAt"`
}

type sonarRegistry struct {
	mu      sync.RWMutex
	custom  map[SessionID]string
	configs map[SessionID]SonarConfig
	tokens  map[SessionID]string
}

func (r *sonarRegistry) config(sessionID SessionID) SonarConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.configs[sessionID]
}

func (r *sonarRegistry) setConfig(sessionID SessionID, config SonarConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.configs[sessionID] = config
}

func (r *sonarRegistry) configSnapshot() map[SessionID]SonarConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.configs) == 0 {
		return nil
	}
	result := make(map[SessionID]SonarConfig, len(r.configs))
	for key, value := range r.configs {
		result[key] = value
	}
	return result
}

func (r *sonarRegistry) replaceConfigs(configs map[SessionID]SonarConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.configs = make(map[SessionID]SonarConfig, len(configs))
	for key, value := range configs {
		value.HasToken = false
		r.configs[key] = value
	}
}

func (r *sonarRegistry) token(sessionID SessionID) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.tokens[sessionID]
}

func (r *sonarRegistry) setToken(sessionID SessionID, token string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if token == "" {
		delete(r.tokens, sessionID)
		return
	}
	r.tokens[sessionID] = token
}

func (r *sonarRegistry) customBinary(sessionID SessionID) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.custom[sessionID]
}

func (r *sonarRegistry) setCustomBinary(sessionID SessionID, binary string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if binary == "" {
		delete(r.custom, sessionID)
		return
	}
	r.custom[sessionID] = binary
}

// DetectSonarScanner cerca sonar-scanner (binario personalizzato, cartella strumenti, PATH).
func (s *Service) DetectSonarScanner(sessionID string) (SonarScannerInfo, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return SonarScannerInfo{}, err
	}
	for _, candidate := range s.sonarScannerCandidates(session.ID) {
		info, statErr := os.Stat(candidate.binary)
		if statErr != nil || info.IsDir() {
			if candidate.source == "custom" {
				return SonarScannerInfo{Binary: candidate.binary, Source: "custom", Error: "il binario di sonar-scanner configurato non esiste"}, nil
			}
			continue
		}
		version, versionErr := cachedToolVersion(candidate.binary, sonarScannerVersion)
		result := SonarScannerInfo{Binary: candidate.binary, Source: candidate.source}
		if versionErr != nil {
			result.Error = versionErr.Error()
			return result, nil
		}
		result.Available = true
		result.Version = version
		return result, nil
	}
	return SonarScannerInfo{Error: "sonar-scanner non trovato: installalo e aggiungilo al PATH, oppure indica il percorso in Go Tool Paths"}, nil
}

type sonarCandidate struct {
	binary string
	source string
}

func (s *Service) sonarScannerCandidates(sessionID SessionID) []sonarCandidate {
	candidates := []sonarCandidate{}
	if custom := s.sonar.customBinary(sessionID); custom != "" {
		candidates = append(candidates, sonarCandidate{binary: custom, source: "custom"})
	}
	if s.toolsRoot != "" {
		candidates = append(candidates, sonarCandidate{binary: filepath.Join(s.toolsRoot, "bin", executableName(sonarScanner)), source: "managed"})
	}
	if found, err := exec.LookPath(sonarScanner); err == nil {
		candidates = append(candidates, sonarCandidate{binary: found, source: "PATH"})
	}
	return candidates
}

func sonarScannerVersion(binary string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), goplsVersionTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "--version")
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return "", fmt.Errorf("sonar-scanner non risponde")
	}
	if err != nil {
		return "", fmt.Errorf("sonar-scanner non eseguibile: %s", strings.TrimSpace(string(output)))
	}
	if match := sonarVersionPattern.FindString(string(output)); match != "" {
		return match, nil
	}
	return strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0]), nil
}

// ConfigureSonarScanner imposta un binario sonar-scanner personalizzato; vuoto ripristina la ricerca automatica.
func (s *Service) ConfigureSonarScanner(sessionID, binary string) error {
	if _, err := s.session(sessionID); err != nil {
		return err
	}
	binary = strings.TrimSpace(binary)
	if binary != "" {
		abs, err := filepath.Abs(binary)
		if err != nil {
			return fmt.Errorf("percorso sonar-scanner non valido: %w", err)
		}
		if info, err := os.Stat(abs); err != nil || info.IsDir() {
			return fmt.Errorf("il percorso indicato non è un eseguibile")
		}
		binary = abs
	}
	s.sonar.setCustomBinary(SessionID(sessionID), binary)
	return nil
}

// SonarConfigFor restituisce la configurazione (senza token) della sessione.
func (s *Service) SonarConfigFor(sessionID string) (SonarConfig, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return SonarConfig{}, err
	}
	config := s.sonar.config(session.ID)
	config.HasToken = s.sonar.token(session.ID) != ""
	return config, nil
}

// SaveSonarConfig salva la configurazione non segreta; il token è separato e solo in memoria.
func (s *Service) SaveSonarConfig(sessionID string, config SonarConfig) (SonarConfig, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return SonarConfig{}, err
	}
	config.ServerURL = strings.TrimSpace(config.ServerURL)
	config.ProjectKey = strings.TrimSpace(config.ProjectKey)
	config.Sources = strings.TrimSpace(config.Sources)
	config.Exclusions = strings.TrimSpace(config.Exclusions)
	config.HasToken = false
	if config.Enabled {
		normalized, err := normalizeSonarServerURL(config.ServerURL)
		if err != nil {
			return SonarConfig{}, err
		}
		config.ServerURL = normalized
		if config.ProjectKey == "" {
			return SonarConfig{}, fmt.Errorf("la chiave del progetto SonarQube è obbligatoria")
		}
	} else {
		config.ServerURL = strings.TrimRight(config.ServerURL, "/")
	}
	if config.Sources == "" {
		config.Sources = "."
	}
	s.sonar.setConfig(session.ID, config)
	if err := s.saveState(); err != nil {
		return SonarConfig{}, err
	}
	stored := s.sonar.config(session.ID)
	stored.HasToken = s.sonar.token(session.ID) != ""
	return stored, nil
}

// SetSonarToken memorizza il token in memoria per la sessione; non viene mai persistito né restituito.
func (s *Service) SetSonarToken(sessionID, token string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	s.sonar.setToken(session.ID, strings.TrimSpace(token))
	return nil
}

func normalizeSonarServerURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" {
		return "", fmt.Errorf("l'URL del server SonarQube è obbligatorio")
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", fmt.Errorf("URL del server SonarQube non valido: usa http(s)://host")
	}
	return raw, nil
}

// RunSonarScan esegue sonar-scanner sul progetto autorizzato e poi importa gli issue dalla Web API.
func (s *Service) RunSonarScan(ctx context.Context, sessionID, token string) (SonarScanResult, error) {
	started := time.Now()
	session, err := s.session(sessionID)
	if err != nil {
		return SonarScanResult{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return SonarScanResult{}, fmt.Errorf("autorizza esplicitamente gli strumenti prima di eseguire una scansione")
	}
	config := s.sonar.config(session.ID)
	if !config.Enabled {
		return SonarScanResult{}, fmt.Errorf("abilita SonarQube per questo progetto prima di scansionare")
	}
	serverURL, err := normalizeSonarServerURL(config.ServerURL)
	if err != nil {
		return SonarScanResult{}, err
	}
	if config.ProjectKey == "" {
		return SonarScanResult{}, fmt.Errorf("configura la chiave del progetto SonarQube")
	}
	if netpolicy.Current().Offline {
		return SonarScanResult{}, netpolicy.ErrOffline
	}
	scanner, err := s.DetectSonarScanner(sessionID)
	if err != nil {
		return SonarScanResult{}, err
	}
	if !scanner.Available {
		return SonarScanResult{}, errors.New(scanner.Error)
	}
	token = s.effectiveSonarToken(session.ID, token)
	if token == "" {
		return SonarScanResult{}, fmt.Errorf("token SonarQube mancante")
	}
	environment, err := s.languageServerEnvironment(session.ID)
	if err != nil {
		return SonarScanResult{}, err
	}
	arguments := []string{
		"-Dsonar.host.url=" + serverURL,
		"-Dsonar.projectKey=" + config.ProjectKey,
		"-Dsonar.sources=" + config.Sources,
		"-Dsonar.projectBaseDir=" + session.Project.RealPath,
	}
	if config.Exclusions != "" {
		arguments = append(arguments, "-Dsonar.exclusions="+config.Exclusions)
	}
	scanContext, cancel := context.WithTimeout(ctx, sonarTimeout)
	defer cancel()
	command := exec.CommandContext(scanContext, scanner.Binary, arguments...)
	command.Dir = session.Project.RealPath
	command.Env = append(environment, "SONAR_TOKEN="+token)
	configureProcess(command, false)
	output, err := command.CombinedOutput()
	trimmed := tailString(string(output), sonarMaxOutput)
	if scanContext.Err() != nil {
		return SonarScanResult{}, fmt.Errorf("scansione SonarQube interrotta per timeout")
	}
	if err != nil {
		return SonarScanResult{}, fmt.Errorf("sonar-scanner è terminato con errore: %s", lastNonEmptyLine(trimmed))
	}
	result := SonarScanResult{ServerURL: serverURL, ProjectKey: config.ProjectKey, Output: trimmed, ScannedAt: time.Now().UTC()}
	// Il server indicizza il report in modo asincrono: senza attendere il task si leggerebbero
	// gli issue dell'analisi precedente.
	fetchErr := s.waitSonarTask(scanContext, session.Project.RealPath, serverURL, token)
	var issues []SonarIssue
	if fetchErr == nil {
		issues, fetchErr = s.fetchSonarIssues(scanContext, session, config, token)
	}
	if fetchErr != nil {
		result.Warning = "scansione completata, ma gli issue non sono ancora disponibili: il server potrebbe impiegare qualche secondo. Riprova con Refresh. (" + fetchErr.Error() + ")"
	} else {
		result.Issues, result.Baselined = applySonarBaseline(session.Project.RealPath, issues)
	}
	result.IssueCount = len(result.Issues)
	result.DurationMS = time.Since(started).Milliseconds()
	summarizeSonar(&result)
	return result, nil
}

// FetchSonarIssues importa gli issue già presenti sul server, senza riavviare la scansione.
func (s *Service) FetchSonarIssues(ctx context.Context, sessionID, token string) (SonarScanResult, error) {
	started := time.Now()
	session, err := s.session(sessionID)
	if err != nil {
		return SonarScanResult{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return SonarScanResult{}, fmt.Errorf("autorizza esplicitamente gli strumenti prima di contattare SonarQube")
	}
	config := s.sonar.config(session.ID)
	if !config.Enabled {
		return SonarScanResult{}, fmt.Errorf("abilita SonarQube per questo progetto")
	}
	serverURL, err := normalizeSonarServerURL(config.ServerURL)
	if err != nil {
		return SonarScanResult{}, err
	}
	if config.ProjectKey == "" {
		return SonarScanResult{}, fmt.Errorf("configura la chiave del progetto SonarQube")
	}
	token = s.effectiveSonarToken(session.ID, token)
	if token == "" {
		return SonarScanResult{}, fmt.Errorf("token SonarQube mancante")
	}
	issues, err := s.fetchSonarIssues(ctx, session, config, token)
	if err != nil {
		return SonarScanResult{}, err
	}
	result := SonarScanResult{ServerURL: serverURL, ProjectKey: config.ProjectKey, ScannedAt: time.Now().UTC()}
	result.Issues, result.Baselined = applySonarBaseline(session.Project.RealPath, issues)
	result.IssueCount = len(result.Issues)
	result.DurationMS = time.Since(started).Milliseconds()
	summarizeSonar(&result)
	return result, nil
}

func (s *Service) effectiveSonarToken(sessionID SessionID, token string) string {
	if token = strings.TrimSpace(token); token != "" {
		s.sonar.setToken(sessionID, token)
		return token
	}
	return s.sonar.token(sessionID)
}

func summarizeSonar(result *SonarScanResult) {
	result.BySeverity = map[string]int{}
	result.ByType = map[string]int{}
	for _, issue := range result.Issues {
		if issue.Severity != "" {
			result.BySeverity[issue.Severity]++
		}
		if issue.Type != "" {
			result.ByType[issue.Type]++
		}
	}
}

type sonarImpact struct {
	SoftwareQuality string `json:"softwareQuality"`
	Severity        string `json:"severity"`
}

type sonarIssueItem struct {
	Key       string        `json:"key"`
	Rule      string        `json:"rule"`
	Severity  string        `json:"severity"`
	Type      string        `json:"type"`
	Component string        `json:"component"`
	Line      int           `json:"line"`
	Message   string        `json:"message"`
	Effort    string        `json:"effort"`
	Status    string        `json:"status"`
	Tags      []string      `json:"tags"`
	Impacts   []sonarImpact `json:"impacts"`
}

type sonarIssuesResponse struct {
	Total  int `json:"total"`
	Ps     int `json:"ps"`
	Paging *struct {
		PageSize int `json:"pageSize"`
		Total    int `json:"total"`
	} `json:"paging"`
	Issues []sonarIssueItem `json:"issues"`
}

// setSonarAuth usa il token come utente Basic: funziona sia su SonarQube 9.x (LTA) sia su 10+ e
// SonarCloud, mentre Bearer è accettato solo dalla 10.
func setSonarAuth(request *http.Request, token string) {
	request.SetBasicAuth(token, "")
	request.Header.Set("Accept", "application/json")
}

// waitSonarTask attende che il Compute Engine abbia elaborato il report appena caricato,
// leggendo l'id del task da .scannerwork/report-task.txt.
func (s *Service) waitSonarTask(ctx context.Context, root, serverURL, token string) error {
	data, err := os.ReadFile(filepath.Join(root, ".scannerwork", "report-task.txt"))
	if err != nil {
		return nil // ponytail: scanner senza report-task (versioni molto vecchie): si importa subito.
	}
	taskID := ""
	for _, line := range strings.Split(string(data), "\n") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(line), "ceTaskId="); ok {
			taskID = value
		}
	}
	if taskID == "" {
		return nil
	}
	parsedURL, err := url.Parse(serverURL)
	if err != nil {
		return err
	}
	if err := netpolicy.Allow("sonarqube", parsedURL.Host); err != nil {
		return err
	}
	client := netpolicy.Client("sonarqube", sonarAPITimeout)
	deadline := time.Now().Add(sonarTaskTimeout)
	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, serverURL+"/api/ce/task?id="+url.QueryEscape(taskID), nil)
		if err != nil {
			return err
		}
		setSonarAuth(request, token)
		response, err := client.Do(request)
		if err != nil {
			return fmt.Errorf("stato dell'analisi non leggibile: %w", err)
		}
		var parsed struct {
			Task struct {
				Status       string `json:"status"`
				ErrorMessage string `json:"errorMessage"`
			} `json:"task"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&parsed)
		response.Body.Close()
		if response.StatusCode != http.StatusOK || decodeErr != nil {
			return fmt.Errorf("stato dell'analisi non leggibile (HTTP %d)", response.StatusCode)
		}
		switch parsed.Task.Status {
		case "SUCCESS":
			return nil
		case "FAILED", "CANCELED":
			return fmt.Errorf("il server non ha elaborato l'analisi: %s %s", parsed.Task.Status, parsed.Task.ErrorMessage)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("il server sta ancora elaborando l'analisi")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(sonarTaskPoll):
		}
	}
}

func (s *Service) fetchSonarIssues(ctx context.Context, session Session, config SonarConfig, token string) ([]SonarIssue, error) {
	if netpolicy.Current().Offline {
		return nil, netpolicy.ErrOffline
	}
	serverURL, err := normalizeSonarServerURL(config.ServerURL)
	if err != nil {
		return nil, err
	}
	parsedURL, err := url.Parse(serverURL)
	if err != nil {
		return nil, fmt.Errorf("URL del server SonarQube non valido")
	}
	host := parsedURL.Host
	if err := netpolicy.Allow("sonarqube", host); err != nil {
		return nil, err
	}
	client := netpolicy.Client("sonarqube", sonarAPITimeout)
	issues := make([]SonarIssue, 0)
	for page := 1; page <= sonarMaxPages; page++ {
		endpoint := fmt.Sprintf("%s/api/issues/search?resolved=false&componentKeys=%s&ps=%d&p=%d",
			serverURL, url.QueryEscape(config.ProjectKey), sonarPageSize, page)
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		setSonarAuth(request, token)
		response, err := client.Do(request)
		if err != nil {
			netpolicy.Record(netpolicy.Event{Category: "sonarqube", Host: host, Outcome: netpolicy.OutcomeError, Detail: err.Error()})
			return nil, fmt.Errorf("richiesta alla Web API fallita: %w", err)
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 16<<20))
		response.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("la Web API ha risposto %d: %s", response.StatusCode, strings.TrimSpace(firstLine(string(body))))
		}
		var parsed sonarIssuesResponse
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, fmt.Errorf("risposta della Web API non valida: %w", err)
		}
		for _, item := range parsed.Issues {
			issues = append(issues, sonarIssueFrom(session.Project.RealPath, item))
		}
		total, size := parsed.Total, parsed.Ps
		if parsed.Paging != nil {
			total, size = parsed.Paging.Total, parsed.Paging.PageSize
		}
		if len(parsed.Issues) == 0 || size <= 0 || page*size >= total {
			break
		}
	}
	netpolicy.Record(netpolicy.Event{Category: "sonarqube", Host: host, Outcome: netpolicy.OutcomeOK, Detail: fmt.Sprintf("%d issues", len(issues))})
	sort.SliceStable(issues, func(i, j int) bool {
		if issues[i].File != issues[j].File {
			return issues[i].File < issues[j].File
		}
		return issues[i].Line < issues[j].Line
	})
	if len(issues) > sonarMaxIssues {
		issues = issues[:sonarMaxIssues]
	}
	return issues, nil
}

func sonarIssueFrom(root string, item sonarIssueItem) SonarIssue {
	file := item.Component
	if index := strings.Index(item.Component, ":"); index >= 0 {
		file = item.Component[index+1:]
	}
	severity, issueType := item.Severity, item.Type
	if len(item.Impacts) > 0 {
		// In modalità MQR un issue può avere più impatti: quello di sicurezza ha la precedenza.
		impact := item.Impacts[0]
		for _, candidate := range item.Impacts {
			if candidate.SoftwareQuality == "SECURITY" {
				impact = candidate
				break
			}
		}
		if severity == "" {
			severity = impact.Severity
		}
		if issueType == "" {
			issueType = impact.SoftwareQuality
		}
	}
	relative := filepath.ToSlash(file)
	if absolute := filepath.Join(root, filepath.FromSlash(file)); relativeWithin(root, absolute) != "" {
		relative = relativeWithin(root, absolute)
	}
	return SonarIssue{Key: item.Key, Rule: item.Rule, Severity: severity, Type: issueType, Message: item.Message, File: relative, Line: item.Line, Effort: item.Effort, Status: item.Status, Tags: item.Tags}
}

func tailString(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[len(value)-limit:]
}

func lastNonEmptyLine(value string) string {
	lines := strings.Split(strings.TrimSpace(value), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		if line := strings.TrimSpace(lines[index]); line != "" {
			return line
		}
	}
	return "nessun dettaglio"
}

func firstLine(value string) string {
	if index := strings.IndexByte(value, '\n'); index >= 0 {
		return value[:index]
	}
	return value
}

// SaveSonarBaseline registra gli issue attuali come accettati, così i nuovi restano visibili.
func (s *Service) SaveSonarBaseline(ctx context.Context, sessionID, token string) (int, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return 0, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return 0, fmt.Errorf("autorizza esplicitamente gli strumenti prima di contattare SonarQube")
	}
	config := s.sonar.config(session.ID)
	if _, err := normalizeSonarServerURL(config.ServerURL); err != nil {
		return 0, err
	}
	if config.ProjectKey == "" {
		return 0, fmt.Errorf("configura la chiave del progetto SonarQube")
	}
	token = s.effectiveSonarToken(session.ID, token)
	if token == "" {
		return 0, fmt.Errorf("token SonarQube mancante")
	}
	issues, err := s.fetchSonarIssues(ctx, session, config, token)
	if err != nil {
		return 0, err
	}
	return writeSonarBaseline(session.Project.RealPath, issues)
}

// ClearSonarBaseline rimuove la baseline: tutti gli issue tornano visibili.
func (s *Service) ClearSonarBaseline(sessionID string) error {
	session, err := s.session(sessionID)
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(session.Project.RealPath, filepath.FromSlash(sonarBaselineFile)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
