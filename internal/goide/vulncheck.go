package goide

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	modulepath "golang.org/x/mod/module"

	"adomnia/internal/languages/golang"
	"adomnia/internal/netpolicy"
)

// Livelli di raggiungibilità di govulncheck: il codice del progetto chiama il simbolo vulnerabile,
// importa solo il package, oppure il modulo è soltanto nel build.
const (
	VulnLevelCalled   = "called"
	VulnLevelImported = "imported"
	VulnLevelRequired = "required"

	maxVulnCallPaths   = 5
	maxVulnFrames      = 40
	vulnAdvisoryURL    = "https://pkg.go.dev/vuln/"
	stdlibModulePath   = "stdlib"
	toolchainModuleVer = "toolchain"
)

// VulnFrame è un passo di un percorso di chiamata: dal codice del progetto al simbolo vulnerabile.
type VulnFrame struct {
	Module    string `json:"module,omitempty"`
	Version   string `json:"version,omitempty"`
	Package   string `json:"package,omitempty"`
	Function  string `json:"function,omitempty"`
	Receiver  string `json:"receiver,omitempty"`
	File      string `json:"file,omitempty"`
	Relative  string `json:"relative,omitempty"`
	Line      int    `json:"line,omitempty"`
	Column    int    `json:"column,omitempty"`
	InProject bool   `json:"inProject"`
}

// VulnFinding riassume un advisory OSV per il modulo analizzato.
type VulnFinding struct {
	ID           string   `json:"id"`
	Aliases      []string `json:"aliases,omitempty"`
	Summary      string   `json:"summary,omitempty"`
	Details      string   `json:"details,omitempty"`
	Published    string   `json:"published,omitempty"`
	Modified     string   `json:"modified,omitempty"`
	URL          string   `json:"url"`
	References   []string `json:"references,omitempty"`
	CVSS         []string `json:"cvss,omitempty"`
	Module       string   `json:"module"`
	FoundVersion string   `json:"foundVersion,omitempty"`
	FixedVersion string   `json:"fixedVersion,omitempty"`
	Level        string   `json:"level"`
	Packages     []string `json:"packages,omitempty"`
	Symbols      []string `json:"symbols,omitempty"`
	// CallPaths partono dal codice del progetto (primo elemento) e arrivano al simbolo vulnerabile (ultimo).
	CallPaths [][]VulnFrame `json:"callPaths,omitempty"`
	// DependencyPath è la catena di moduli dal modulo principale a quello vulnerabile (go mod graph).
	DependencyPath []string `json:"dependencyPath,omitempty"`
	// GoModVersion è la versione richiesta nel go.mod del progetto, se il modulo è un requirement diretto o indiretto.
	GoModVersion string `json:"goModVersion,omitempty"`
}

// VulnReport è il risultato di una scansione govulncheck.
type VulnReport struct {
	ModulePath      string        `json:"modulePath"`
	ModuleDirectory string        `json:"moduleDirectory"`
	ScannedAt       string        `json:"scannedAt"`
	ScannerVersion  string        `json:"scannerVersion,omitempty"`
	DatabaseUpdated string        `json:"databaseUpdated,omitempty"`
	GoVersion       string        `json:"goVersion,omitempty"`
	Findings        []VulnFinding `json:"findings"`
}

// Messaggi dello stream JSON di govulncheck (protocollo v1): un oggetto per riga, uno solo dei campi valorizzato.
type govulnMessage struct {
	Config *struct {
		ScannerVersion string `json:"scanner_version"`
		DB             string `json:"db"`
		DBLastModified string `json:"db_last_modified"`
		GoVersion      string `json:"go_version"`
	} `json:"config"`
	OSV     *govulnOSV     `json:"osv"`
	Finding *govulnFinding `json:"finding"`
}

type govulnOSV struct {
	ID        string   `json:"id"`
	Aliases   []string `json:"aliases"`
	Summary   string   `json:"summary"`
	Details   string   `json:"details"`
	Published string   `json:"published"`
	Modified  string   `json:"modified"`
	Severity  []struct {
		Type  string `json:"type"`
		Score string `json:"score"`
	} `json:"severity"`
	References []struct {
		Type string `json:"type"`
		URL  string `json:"url"`
	} `json:"references"`
	DatabaseSpecific struct {
		URL string `json:"url"`
	} `json:"database_specific"`
}

type govulnFinding struct {
	OSV          string        `json:"osv"`
	FixedVersion string        `json:"fixed_version"`
	Trace        []govulnFrame `json:"trace"`
}

type govulnFrame struct {
	Module   string `json:"module"`
	Version  string `json:"version"`
	Package  string `json:"package"`
	Function string `json:"function"`
	Receiver string `json:"receiver"`
	Position *struct {
		Filename string `json:"filename"`
		Line     int    `json:"line"`
		Column   int    `json:"column"`
	} `json:"position"`
}

// parseGovulncheckStream legge lo stream JSON di govulncheck e aggrega i finding per advisory.
func parseGovulncheckStream(output []byte) (VulnReport, error) {
	report := VulnReport{Findings: []VulnFinding{}}
	advisories := map[string]govulnOSV{}
	byID := map[string]*VulnFinding{}
	order := []string{}
	decoder := json.NewDecoder(bytes.NewReader(output))
	parsed := 0
	for {
		var message govulnMessage
		err := decoder.Decode(&message)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if parsed == 0 {
				return VulnReport{}, fmt.Errorf("output di govulncheck non riconosciuto: %w", err)
			}
			break // output troncato: si tiene quanto letto
		}
		parsed++
		switch {
		case message.Config != nil:
			report.ScannerVersion = message.Config.ScannerVersion
			report.DatabaseUpdated = message.Config.DBLastModified
			report.GoVersion = message.Config.GoVersion
		case message.OSV != nil:
			advisories[message.OSV.ID] = *message.OSV
		case message.Finding != nil:
			finding := byID[message.Finding.OSV]
			if finding == nil {
				finding = &VulnFinding{ID: message.Finding.OSV, Level: VulnLevelRequired}
				byID[finding.ID] = finding
				order = append(order, finding.ID)
			}
			mergeVulnFinding(finding, *message.Finding)
		}
	}
	for _, id := range order {
		finding := byID[id]
		applyAdvisory(finding, advisories[id])
		report.Findings = append(report.Findings, *finding)
	}
	sortVulnFindings(report.Findings)
	return report, nil
}

func mergeVulnFinding(target *VulnFinding, source govulnFinding) {
	if source.FixedVersion != "" {
		target.FixedVersion = source.FixedVersion
	}
	if len(source.Trace) == 0 {
		return
	}
	vulnerable := source.Trace[0]
	if target.Module == "" {
		target.Module = vulnerable.Module
		target.FoundVersion = vulnerable.Version
	}
	level := vulnLevelOf(vulnerable)
	if vulnLevelRank(level) > vulnLevelRank(target.Level) {
		target.Level = level
	}
	target.Packages = appendDistinct(target.Packages, vulnerable.Package)
	if vulnerable.Function != "" {
		target.Symbols = appendDistinct(target.Symbols, qualifiedSymbol(vulnerable))
	}
	if level != VulnLevelCalled || len(target.CallPaths) >= maxVulnCallPaths {
		return
	}
	path := make([]VulnFrame, 0, len(source.Trace))
	// govulncheck ordina la traccia dal simbolo vulnerabile verso il codice del progetto: la si gira.
	for index := len(source.Trace) - 1; index >= 0 && len(path) < maxVulnFrames; index-- {
		path = append(path, vulnFrameOf(source.Trace[index]))
	}
	if !containsCallPath(target.CallPaths, path) {
		target.CallPaths = append(target.CallPaths, path)
	}
}

func vulnLevelOf(frame govulnFrame) string {
	switch {
	case frame.Function != "":
		return VulnLevelCalled
	case frame.Package != "":
		return VulnLevelImported
	default:
		return VulnLevelRequired
	}
}

func vulnLevelRank(level string) int {
	switch level {
	case VulnLevelCalled:
		return 3
	case VulnLevelImported:
		return 2
	default:
		return 1
	}
}

func qualifiedSymbol(frame govulnFrame) string {
	if frame.Receiver != "" {
		return strings.TrimPrefix(frame.Receiver, "*") + "." + frame.Function
	}
	return frame.Function
}

func vulnFrameOf(frame govulnFrame) VulnFrame {
	result := VulnFrame{Module: frame.Module, Version: frame.Version, Package: frame.Package, Function: frame.Function, Receiver: frame.Receiver}
	if frame.Position != nil {
		// govulncheck scrive il file relativo alla radice del suo modulo: si risolve dopo (resolveVulnFrames).
		result.File = filepath.ToSlash(frame.Position.Filename)
		result.Line = frame.Position.Line
		result.Column = frame.Position.Column
	}
	return result
}

// vulnSourceRoots dice dove stanno i sorgenti: il modulo analizzato, la cache dei moduli e GOROOT.
type vulnSourceRoots struct {
	ProjectRoot     string
	ModulePath      string
	ModuleDirectory string
	GoRoot          string
	ModCache        string
}

// resolveVulnFrames trasforma i file relativi di govulncheck in percorsi assoluti apribili,
// e marca come "del progetto" quelli del modulo analizzato con il percorso relativo al progetto.
func resolveVulnFrames(findings []VulnFinding, roots vulnSourceRoots) {
	for findingIndex := range findings {
		for pathIndex := range findings[findingIndex].CallPaths {
			for frameIndex := range findings[findingIndex].CallPaths[pathIndex] {
				resolveVulnFrame(&findings[findingIndex].CallPaths[pathIndex][frameIndex], roots)
			}
		}
	}
}

func resolveVulnFrame(frame *VulnFrame, roots vulnSourceRoots) {
	if frame.File == "" {
		return
	}
	file := filepath.FromSlash(frame.File)
	if !filepath.IsAbs(file) {
		base := vulnFrameBase(*frame, roots)
		if base == "" {
			return
		}
		file = filepath.Join(base, file)
	}
	frame.File = file
	// Solo il modulo analizzato è "codice del progetto": una dipendenza resta tale anche se vendorizzata nel repository.
	if roots.ProjectRoot == "" || frame.Module != roots.ModulePath {
		return
	}
	relative, err := filepath.Rel(roots.ProjectRoot, file)
	if err == nil && relative != "." && !strings.HasPrefix(relative, "..") && !filepath.IsAbs(relative) {
		frame.Relative = filepath.ToSlash(relative)
		frame.InProject = true
	}
}

func vulnFrameBase(frame VulnFrame, roots vulnSourceRoots) string {
	switch {
	case frame.Module == roots.ModulePath:
		return roots.ModuleDirectory
	case frame.Module == stdlibModulePath || frame.Module == toolchainModuleVer:
		if roots.GoRoot == "" {
			return ""
		}
		return filepath.Join(roots.GoRoot, "src")
	case roots.ModCache != "" && frame.Version != "":
		escaped, err := modulepath.EscapePath(frame.Module)
		if err != nil {
			return ""
		}
		version, err := modulepath.EscapeVersion(frame.Version)
		if err != nil {
			return ""
		}
		return filepath.Join(roots.ModCache, filepath.FromSlash(escaped)+"@"+version)
	}
	return ""
}

func containsCallPath(paths [][]VulnFrame, candidate []VulnFrame) bool {
	for _, path := range paths {
		if len(path) != len(candidate) {
			continue
		}
		same := true
		for index := range path {
			if path[index].Function != candidate[index].Function || path[index].Package != candidate[index].Package || path[index].Line != candidate[index].Line {
				same = false
				break
			}
		}
		if same {
			return true
		}
	}
	return false
}

func applyAdvisory(finding *VulnFinding, advisory govulnOSV) {
	finding.Aliases = advisory.Aliases
	finding.Summary = advisory.Summary
	finding.Details = advisory.Details
	finding.Published = advisory.Published
	finding.Modified = advisory.Modified
	finding.URL = vulnAdvisoryURL + finding.ID
	if advisory.DatabaseSpecific.URL != "" {
		finding.URL = advisory.DatabaseSpecific.URL
	}
	for _, severity := range advisory.Severity {
		if severity.Score != "" {
			finding.CVSS = append(finding.CVSS, severity.Score)
		}
	}
	for _, reference := range advisory.References {
		if reference.URL != "" {
			finding.References = appendDistinct(finding.References, reference.URL)
		}
	}
}

// sortVulnFindings mette prima ciò che il codice chiama davvero, poi per modulo e ID.
func sortVulnFindings(findings []VulnFinding) {
	sort.SliceStable(findings, func(left, right int) bool {
		a, b := findings[left], findings[right]
		if vulnLevelRank(a.Level) != vulnLevelRank(b.Level) {
			return vulnLevelRank(a.Level) > vulnLevelRank(b.Level)
		}
		if a.Module != b.Module {
			return a.Module < b.Module
		}
		return a.ID < b.ID
	})
}

// appendDistinct aggiunge value se non vuoto e non già presente.
func appendDistinct(values []string, value string) []string {
	if value == "" {
		return values
	}
	return appendUnique(values, value)
}

// dependencyPathTo trova la catena di moduli più corta dal modulo principale a target nel `go mod graph`.
func dependencyPathTo(graphOutput, mainModule, target string) []string {
	if target == "" || target == mainModule || target == stdlibModulePath || target == toolchainModuleVer {
		return nil
	}
	edges := map[string][]string{}
	for _, line := range strings.Split(graphOutput, "\n") {
		from, to, ok := strings.Cut(strings.TrimSpace(line), " ")
		if !ok {
			continue
		}
		fromPath := modulePathOnly(from)
		edges[fromPath] = append(edges[fromPath], modulePathOnly(to))
	}
	previous := map[string]string{mainModule: ""}
	queue := []string{mainModule}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current == target {
			path := []string{}
			for step := target; step != ""; step = previous[step] {
				path = append([]string{step}, path...)
			}
			return path
		}
		for _, next := range edges[current] {
			if _, seen := previous[next]; seen {
				continue
			}
			previous[next] = current
			queue = append(queue, next)
		}
	}
	return nil
}

func modulePathOnly(entry string) string {
	path, _, _ := strings.Cut(entry, "@")
	return path
}

// VulnerabilityScan esegue govulncheck sul modulo con percorsi di chiamata, versione corretta e catena di dipendenze.
// È on-demand: il database delle vulnerabilità (vuln.go.dev) richiede rete e rispetta la politica di rete.
func (s *Service) VulnerabilityScan(sessionID, moduleDirectory string) (VulnReport, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return VulnReport{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return VulnReport{}, fmt.Errorf("autorizza esplicitamente gli strumenti per questo progetto")
	}
	directory, err := s.documents.resolveDirectory(session.Project, moduleDirectory)
	if err != nil {
		return VulnReport{}, err
	}
	modulePath := golang.ReadModulePath(filepath.Join(directory, "go.mod"))
	if modulePath == "" {
		return VulnReport{}, fmt.Errorf("go.mod non trovato o senza direttiva module in %s", directory)
	}
	tool, err := s.DetectGoTool(sessionID, "govulncheck")
	if err != nil {
		return VulnReport{}, err
	}
	if !tool.Available {
		return VulnReport{}, fmt.Errorf("govulncheck non installato: installalo da Tools → Go Tools o con go install golang.org/x/vuln/cmd/govulncheck@latest")
	}
	environment, envErr := s.toolchain.Environment(session.ID, nil)
	if envErr != nil {
		environment = netpolicy.Environ()
	}
	output, err := runGovulncheckJSON(directory, tool.Path, environment)
	if err != nil {
		return VulnReport{}, err
	}
	report, err := parseGovulncheckStream(output)
	if err != nil {
		return VulnReport{}, err
	}
	report.ModulePath = modulePath
	report.ModuleDirectory = directory
	report.ScannedAt = time.Now().UTC().Format(time.RFC3339)
	s.enrichVulnFindings(session, directory, modulePath, report.Findings)
	return report, nil
}

// enrichVulnFindings aggiunge catena di dipendenze e versione nel go.mod (best effort, offline).
func (s *Service) enrichVulnFindings(session Session, directory, modulePath string, findings []VulnFinding) {
	if len(findings) == 0 {
		return
	}
	graphOutput, _ := s.runModuleCommand(session.ID, directory, dependencyGraphTimeout, "mod", "graph")
	required := map[string]string{}
	if state, err := readDependencyState(session.Project, directory); err == nil {
		for _, dependency := range state.Dependencies {
			required[dependency.Path] = dependency.Version
		}
	}
	for index := range findings {
		findings[index].DependencyPath = dependencyPathTo(graphOutput, modulePath, findings[index].Module)
		findings[index].GoModVersion = required[findings[index].Module]
	}
	roots := vulnSourceRoots{ProjectRoot: session.Project.RootPath, ModulePath: modulePath, ModuleDirectory: directory}
	if envOutput, err := s.runModuleCommand(session.ID, directory, dependencyGraphTimeout, "env", "GOROOT", "GOMODCACHE"); err == nil {
		lines := strings.Split(strings.TrimSpace(envOutput), "\n")
		if len(lines) == 2 {
			roots.GoRoot = strings.TrimSpace(lines[0])
			roots.ModCache = strings.TrimSpace(lines[1])
		}
	}
	resolveVulnFrames(findings, roots)
}

func runGovulncheckJSON(directory, binary string, environment []string) ([]byte, error) {
	if err := netpolicy.Allow("vulncheck", "vuln.go.dev"); err != nil {
		return nil, err
	}
	netpolicy.Record(netpolicy.Event{Category: "vulncheck", Host: "vuln.go.dev", Outcome: netpolicy.OutcomeOK, Detail: "govulncheck"})
	ctx, cancel := context.WithTimeout(context.Background(), dependencyVulnTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "-json", "./...")
	command.Dir = directory
	command.Env = environment
	configureProcess(command, false)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	if ctx.Err() != nil {
		return nil, fmt.Errorf("govulncheck scaduto dopo %s", dependencyVulnTimeout)
	}
	output := stdout.Bytes()
	if len(output) > maxModuleGraphBytes {
		output = output[:maxModuleGraphBytes]
	}
	// Con -json govulncheck esce 0 anche se trova vulnerabilità: un errore senza output JSON è un vero errore.
	if err != nil && len(bytes.TrimSpace(output)) == 0 {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("govulncheck: %s", message)
	}
	return output, nil
}
