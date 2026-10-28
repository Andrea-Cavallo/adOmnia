package codestudio

import (
	"bytes"
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	modulepath "golang.org/x/mod/module"

	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
	"github.com/Andrea-Cavallo/adOmnia/internal/netpolicy"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
	"github.com/Andrea-Cavallo/adOmnia/internal/securityintel/govuln"
)

// Il modello e il parser dello stream govulncheck vivono in internal/securityintel/govuln:
// lo usano sia il pannello vulnerabilità di Code Studio sia l'adapter Go del Security
// Engine. Qui restano i nomi pubblici già esposti ai binding Wails e la parte che
// dipende dalla sessione: risoluzione dei percorsi, grafo dei moduli, avvio del tool.

// Livelli di raggiungibilità di govulncheck.
const (
	VulnLevelCalled   = govuln.LevelCalled
	VulnLevelImported = govuln.LevelImported
	VulnLevelRequired = govuln.LevelRequired

	stdlibModulePath   = govuln.StdlibModulePath
	toolchainModuleVer = govuln.ToolchainModuleVer
)

// VulnFrame, VulnFinding e VulnReport sono alias del modello condiviso: i nomi e i tag
// JSON esposti ai binding Wails restano identici.
type (
	VulnFrame   = govuln.Frame
	VulnFinding = govuln.Finding
	VulnReport  = govuln.Report
)

// parseGovulncheckStream legge lo stream JSON di govulncheck e aggrega i finding per advisory.
func parseGovulncheckStream(output []byte) (VulnReport, error) {
	return govuln.ParseStream(output)
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
	// Solo il modulo analizzato è "codice del progetto": una dipendenza resta tale
	// anche se vendorizzata nel repository.
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

// dependencyPathTo trova la catena di moduli più corta dal modulo principale a target nel `go mod graph`.
func dependencyPathTo(graphOutput, mainModule, target string) []string {
	if target == "" || target == mainModule || target == govuln.StdlibModulePath || target == govuln.ToolchainModuleVer {
		return nil
	}
	edges := map[string][]string{}
	for line := range strings.SplitSeq(graphOutput, "\n") {
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
		return VulnReport{}, fmt.Errorf("explicitly authorize the tools for this project")
	}
	directory, err := s.documents.resolveDirectory(session.Project, moduleDirectory)
	if err != nil {
		return VulnReport{}, err
	}
	modulePath := golang.ReadModulePath(filepath.Join(directory, "go.mod"))
	if modulePath == "" {
		return VulnReport{}, fmt.Errorf("go.mod not found or without a module directive in %s", directory)
	}
	tool, err := s.DetectGoTool(sessionID, "govulncheck")
	if err != nil {
		return VulnReport{}, err
	}
	if !tool.Available {
		return VulnReport{}, fmt.Errorf("govulncheck is not installed: install it from Tools → Go Tools or with go install golang.org/x/vuln/cmd/govulncheck@latest")
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
	command := procutil.CommandContext(ctx, binary, "-json", "./...")
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
