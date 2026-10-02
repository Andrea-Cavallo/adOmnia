package goide

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const baseCoverageTimeout = 10 * time.Minute

// BaseCoverage è la coverage degli stessi package misurata sul merge-base con il branch base,
// per confrontare il totale della pull request con quello di partenza.
type BaseCoverage struct {
	Base       string            `json:"base"`
	MergeBase  string            `json:"mergeBase"`
	Statements int               `json:"statements"`
	Covered    int               `json:"covered"`
	Percent    float64           `json:"percent"`
	Packages   []CoveragePackage `json:"packages"`
	// Missing sono i package che sul branch base non esistono (nuovi nella pull request).
	Missing []string `json:"missing"`
	// TestsFailed segnala test falliti sul base: la coverage resta valida ma va letta con cautela.
	TestsFailed bool `json:"testsFailed"`
}

// BaseBranchCoverage esegue `go test -coverprofile` sui package indicati (cartelle relative al
// progetto, come nel report corrente) in un worktree Git temporaneo al merge-base con base.
// Il working tree dell'utente non viene toccato; il worktree è rimosso alla fine.
func (s *Service) BaseBranchCoverage(sessionID, base string, packageDirs, buildTags []string) (BaseCoverage, error) {
	session, paths, err := s.vcsPaths(sessionID)
	if err != nil {
		return BaseCoverage{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return BaseCoverage{}, errors.New("autorizza esplicitamente gli strumenti per questo progetto")
	}
	base = strings.TrimSpace(base)
	if base == "" || strings.HasPrefix(base, "-") || strings.ContainsAny(base, " \t\r\n") {
		return BaseCoverage{}, fmt.Errorf("branch base non valido: %q", base)
	}
	if len(packageDirs) == 0 {
		return BaseCoverage{}, errors.New("nessun package nel report di coverage")
	}
	ctx, cancel := context.WithTimeout(context.Background(), baseCoverageTimeout)
	defer cancel()
	mergeBase, err := gitOutput(ctx, paths.repoRoot, "merge-base", base, "HEAD")
	if err != nil {
		return BaseCoverage{}, fmt.Errorf("merge-base con %s non trovato: %w", base, err)
	}
	worktree, err := os.MkdirTemp("", "adomnia-base-coverage-")
	if err != nil {
		return BaseCoverage{}, err
	}
	_ = os.Remove(worktree)
	if _, err := gitOutput(ctx, paths.repoRoot, "worktree", "add", "--detach", "--quiet", worktree, mergeBase); err != nil {
		return BaseCoverage{}, fmt.Errorf("worktree temporaneo non creato: %w", err)
	}
	defer func() {
		_, _ = gitOutput(context.Background(), paths.repoRoot, "worktree", "remove", "--force", worktree)
		_ = os.RemoveAll(worktree)
	}()

	projectOffset, err := filepath.Rel(paths.repoRoot, paths.projectRoot)
	if err != nil {
		return BaseCoverage{}, err
	}
	baseProject := filepath.Join(worktree, projectOffset)
	result := BaseCoverage{Base: base, MergeBase: shortHash(mergeBase), Packages: []CoveragePackage{}, Missing: []string{}}
	byModule := map[string][]string{}
	for _, dir := range packageDirs {
		dir = path.Clean(filepath.ToSlash(dir))
		if dir == ".." || strings.HasPrefix(dir, "../") || path.IsAbs(dir) {
			return BaseCoverage{}, fmt.Errorf("package fuori dal progetto: %s", dir)
		}
		if !hasGoFiles(filepath.Join(baseProject, filepath.FromSlash(dir))) {
			result.Missing = append(result.Missing, dir)
			continue
		}
		module := moduleForDir(session.Project.RealPath, session.Project.Modules, dir)
		byModule[module] = append(byModule[module], dir)
	}
	environment, err := s.toolchain.Environment(SessionID(sessionID), nil)
	if err != nil {
		return BaseCoverage{}, err
	}
	binary, err := s.toolchain.GoBinary(SessionID(sessionID))
	if err != nil {
		return BaseCoverage{}, err
	}
	for module, dirs := range byModule {
		report, failed, err := runBaseCoverage(ctx, binary, environment, baseProject, module, dirs, buildTags)
		if err != nil {
			return BaseCoverage{}, err
		}
		result.TestsFailed = result.TestsFailed || failed
		result.Statements += report.Statements
		result.Covered += report.Covered
		result.Packages = append(result.Packages, report.Packages...)
	}
	result.Percent = percent(result.Covered, result.Statements)
	sort.Slice(result.Packages, func(left, right int) bool {
		return result.Packages[left].ImportPath < result.Packages[right].ImportPath
	})
	sort.Strings(result.Missing)
	return result, nil
}

func runBaseCoverage(ctx context.Context, binary string, environment []string, baseProject, module string, dirs, buildTags []string) (CoverageReport, bool, error) {
	moduleDir := filepath.Join(baseProject, filepath.FromSlash(module))
	profile, err := newCoverageProfilePath()
	if err != nil {
		return CoverageReport{}, false, err
	}
	defer os.Remove(profile)
	arguments := []string{"test", "-count=1", "-coverprofile", profile}
	if len(buildTags) > 0 {
		arguments = append(arguments, "-tags", strings.Join(buildTags, ","))
	}
	for _, dir := range dirs {
		relative := strings.TrimPrefix(strings.TrimPrefix(dir, module), "/")
		if relative == "" || relative == "." {
			arguments = append(arguments, ".")
		} else {
			arguments = append(arguments, "./"+relative)
		}
	}
	command := exec.CommandContext(ctx, binary, arguments...)
	command.Dir = moduleDir
	command.Env = environment
	configureProcess(command, false)
	var output bytes.Buffer
	command.Stdout, command.Stderr = &output, &output
	runErr := command.Run()
	if ctx.Err() != nil {
		return CoverageReport{}, false, errors.New("coverage del branch base scaduta")
	}
	data, readErr := os.ReadFile(profile)
	if readErr != nil || len(data) == 0 {
		message := strings.TrimSpace(output.String())
		if len(message) > 2000 {
			message = message[len(message)-2000:]
		}
		return CoverageReport{}, false, fmt.Errorf("go test sul branch base non ha prodotto coverage: %s", message)
	}
	report, err := buildCoverageReport(baseProject, module, readModulePath(filepath.Join(moduleDir, "go.mod")), data)
	return report, runErr != nil, err
}

// moduleForDir restituisce la cartella (relativa al progetto) del modulo più interno che contiene dir.
func moduleForDir(projectRoot string, modules []GoModule, dir string) string {
	best, bestLength := ".", -1
	for _, module := range modules {
		relative := filepath.ToSlash(relativeWithin(projectRoot, module.Path))
		length := len(relative)
		if relative == "" || relative == "." {
			relative, length = ".", 0
		}
		contains := relative == "." || dir == relative || strings.HasPrefix(dir, relative+"/")
		if contains && length > bestLength {
			best, bestLength = relative, length
		}
	}
	return best
}

func hasGoFiles(directory string) bool {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".go") {
			return true
		}
	}
	return false
}

func gitOutput(ctx context.Context, dir string, arguments ...string) (string, error) {
	command := exec.CommandContext(ctx, "git", arguments...)
	command.Dir = dir
	configureProcess(command, false)
	var stdout, stderr bytes.Buffer
	command.Stdout, command.Stderr = &stdout, &stderr
	if err := command.Run(); err != nil {
		return "", fmt.Errorf("%s", strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

func shortHash(hash string) string {
	if len(hash) > 12 {
		return hash[:12]
	}
	return hash
}
