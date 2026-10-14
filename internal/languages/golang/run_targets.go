package golang

import (
	"context"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"adomnia/internal/ide/project"
	"adomnia/internal/ide/run"
	"adomnia/internal/procutil"
)

const runTargetDiscoveryTimeout = 30 * time.Second

// DiscoverRunTargets finds executable main packages in one Go unit. go list
// applies the active build constraints; the parser walk keeps discovery useful
// when dependencies or the Go executable are unavailable.
func (*Language) DiscoverRunTargets(ctx context.Context, unitRoot string) ([]run.RunTarget, error) {
	root, err := filepath.Abs(filepath.Clean(unitRoot))
	if err != nil {
		return nil, fmt.Errorf("invalid Go unit root: %w", err)
	}
	discoveryCtx, cancel := context.WithTimeout(ctx, runTargetDiscoveryTimeout)
	defer cancel()
	if targets, err := discoverRunTargetsWithGoList(discoveryCtx, root); err == nil {
		return targets, nil
	}
	return discoverRunTargetsWithParser(discoveryCtx, root)
}

func discoverRunTargetsWithGoList(ctx context.Context, root string) ([]run.RunTarget, error) {
	cmd := procutil.CommandContext(ctx, "go", "list", "-e", "-json", "./...")
	cmd.Dir = root
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	type listedPackage struct {
		Dir      string
		Name     string
		GoFiles  []string
		CgoFiles []string
	}
	decoder := json.NewDecoder(io.LimitReader(stdout, 8<<20))
	targets := make([]run.RunTarget, 0)
	for {
		var pkg listedPackage
		if err := decoder.Decode(&pkg); err != nil {
			if err == io.EOF {
				break
			}
			_ = cmd.Wait()
			return nil, err
		}
		if pkg.Name == "main" && packageHasMain(pkg.Dir, append(pkg.GoFiles, pkg.CgoFiles...)) {
			targets = append(targets, makeRunTarget(root, pkg.Dir))
		}
	}
	if err := cmd.Wait(); err != nil {
		return nil, err
	}
	return normalizeRunTargets(targets), nil
}

func discoverRunTargetsWithParser(ctx context.Context, root string) ([]run.RunTarget, error) {
	targets := make([]run.RunTarget, 0)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root {
			if project.IgnoredDirectory(entry.Name()) {
				return filepath.SkipDir
			}
			if _, err := os.Stat(filepath.Join(path, "go.mod")); err == nil {
				return filepath.SkipDir
			}
		}
		entries, err := os.ReadDir(path)
		if err != nil {
			return nil
		}
		files := make([]string, 0)
		for _, item := range entries {
			name := item.Name()
			if item.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") || hasIgnoreBuildTag(filepath.Join(path, name)) {
				continue
			}
			files = append(files, name)
		}
		if packageHasMain(path, files) {
			targets = append(targets, makeRunTarget(root, path))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return normalizeRunTargets(targets), nil
}

func packageHasMain(directory string, files []string) bool {
	fset := token.NewFileSet()
	for _, name := range files {
		parsed, err := parser.ParseFile(fset, filepath.Join(directory, name), nil, 0)
		if err != nil || parsed.Name.Name != "main" {
			continue
		}
		for _, declaration := range parsed.Decls {
			fn, ok := declaration.(*ast.FuncDecl)
			if ok && fn.Recv == nil && fn.Name.Name == "main" && fn.Type.Params.NumFields() == 0 && (fn.Type.Results == nil || fn.Type.Results.NumFields() == 0) {
				return true
			}
		}
	}
	return false
}

func hasIgnoreBuildTag(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	prefix := string(data)
	if len(prefix) > 4096 {
		prefix = prefix[:4096]
	}
	for _, line := range strings.Split(prefix, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "package ") {
			break
		}
		if trimmed == "//go:build ignore" {
			return true
		}
	}
	return false
}

func makeRunTarget(moduleDir, directory string) run.RunTarget {
	relative, err := filepath.Rel(moduleDir, directory)
	if err != nil || relative == "." {
		relative = "."
	} else {
		relative = "./" + filepath.ToSlash(relative)
	}
	label := filepath.Base(directory)
	if relative == "." {
		label = filepath.Base(moduleDir)
	}
	return run.RunTarget{Dir: directory, ModuleDir: moduleDir, Package: relative, Label: label}
}

func normalizeRunTargets(targets []run.RunTarget) []run.RunTarget {
	seen := make(map[string]bool)
	result := make([]run.RunTarget, 0, len(targets))
	for _, target := range targets {
		key := strings.ToLower(filepath.Clean(target.Dir))
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, target)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Package < result[j].Package })
	return result
}

// ResolveRunTarget replaces an implicit dot or a Go file with its owning main
// package. Explicit package targets pass through unchanged.
func (l *Language) ResolveRunTarget(ctx context.Context, request run.ResolveTargetRequest) (run.RunTarget, error) {
	root := filepath.Clean(request.Root)
	workingDirectory := filepath.Clean(request.WorkingDirectory)
	if workingDirectory == "" || workingDirectory == "." {
		workingDirectory = root
	}
	target := strings.TrimSpace(request.Target)
	if target == "" {
		target = "."
	}
	if strings.HasSuffix(strings.ToLower(target), ".go") {
		directory := filepath.Dir(filepath.Join(workingDirectory, filepath.FromSlash(target)))
		moduleDir := nearestModuleRoot(root, directory)
		return makeRunTarget(moduleDir, directory), nil
	}
	if target != "." || (request.Kind != "run" && request.Kind != "build" && request.Kind != "debug") {
		return run.RunTarget{Dir: workingDirectory, ModuleDir: workingDirectory, Package: filepath.ToSlash(target), Label: target}, nil
	}
	moduleDir := nearestModuleRoot(root, workingDirectory)
	targets, err := l.DiscoverRunTargets(ctx, moduleDir)
	if err != nil {
		return run.RunTarget{}, err
	}
	for _, candidate := range targets {
		if project.SamePath(candidate.Dir, workingDirectory) {
			return candidate, nil
		}
	}
	if len(targets) == 1 {
		return targets[0], nil
	}
	if len(targets) > 1 {
		moduleName := filepath.Base(moduleDir)
		if path := ReadModulePath(filepath.Join(moduleDir, "go.mod")); path != "" {
			moduleName = filepath.Base(path)
		}
		preferred := "./cmd/" + moduleName
		for _, candidate := range targets {
			if candidate.Package == preferred {
				return candidate, nil
			}
		}
		packages := make([]string, len(targets))
		for index := range targets {
			packages[index] = targets[index].Package
		}
		return run.RunTarget{}, fmt.Errorf("Multiple main packages found under %s: %s; choose a run target", root, strings.Join(packages, ", "))
	}
	return run.RunTarget{}, fmt.Errorf("No main package found under %s", root)
}

func nearestModuleRoot(projectRoot, directory string) string {
	for current := filepath.Clean(directory); ; current = filepath.Dir(current) {
		if info, err := os.Stat(filepath.Join(current, "go.mod")); err == nil && !info.IsDir() {
			return current
		}
		if project.SamePath(current, projectRoot) {
			return projectRoot
		}
		parent := filepath.Dir(current)
		if parent == current || project.EnsureWithin(projectRoot, parent) != nil {
			return projectRoot
		}
	}
}
