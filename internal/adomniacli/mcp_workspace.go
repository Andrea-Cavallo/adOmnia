package adomniacli

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
)

// Visibility for agents: what the workspace is before asking OSGi questions. A large project
// is summarized (languages, sizes, top level) and files are searchable by name/suffix, so an
// agent can orient itself without reading the whole tree.

const (
	mcpOverviewEntries = 50000
	mcpFindLimit       = 500
)

// workspaceLanguageMarkers maps a marker file to the languages it implies.
var workspaceLanguageMarkers = map[string][]string{
	"go.mod": {"go"}, "go.work": {"go"},
	"pom.xml": {"java"}, "build.gradle": {"java"}, "build.gradle.kts": {"java"},
	"Cargo.toml":     {"rust"},
	"package.json":   {"typescript"},
	"pyproject.toml": {"python"}, "setup.py": {"python"}, "requirements.txt": {"python"},
	"composer.json": {"php"}, "Gemfile": {"ruby"},
	"CMakeLists.txt": {"cpp"}, "meson.build": {"cpp"},
	"Dockerfile": {"docker"}, "docker-compose.yml": {"docker"},
	".project": {"eclipse"}, "MANIFEST.MF": {"osgi"},
}

func (s *mcpServer) workspaceOverview(args mcpWorkspaceArgs) (string, error) {
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	languages := map[string]bool{}
	counts := map[string]int{}
	extensions := map[string]int{}
	var topLevel []map[string]any
	files, directories := 0, 0
	visited := 0
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return filepath.SkipDir
		}
		if visited >= mcpOverviewEntries {
			return filepath.SkipAll
		}
		visited++
		name := entry.Name()
		if entry.IsDir() {
			if path != root && ignoredWorkspaceDir(name) {
				return filepath.SkipDir
			}
			directories++
			if filepath.Dir(path) == root {
				topLevel = append(topLevel, map[string]any{"name": name, "directory": true})
			}
			return nil
		}
		files++
		if filepath.Dir(path) == root {
			topLevel = append(topLevel, map[string]any{"name": name, "directory": false})
		}
		if implied, ok := workspaceLanguageMarkers[name]; ok {
			for _, language := range implied {
				languages[language] = true
			}
		}
		extension := strings.ToLower(filepath.Ext(name))
		if extension != "" {
			extensions[extension]++
		}
		return nil
	})
	sort.Slice(topLevel, func(i, j int) bool {
		if topLevel[i]["directory"] != topLevel[j]["directory"] {
			return topLevel[i]["directory"] == true
		}
		return topLevel[i]["name"].(string) < topLevel[j]["name"].(string)
	})
	type extensionCount struct {
		Extension string `json:"extension"`
		Count     int    `json:"count"`
	}
	topExtensions := make([]extensionCount, 0, len(extensions))
	for extension, count := range extensions {
		topExtensions = append(topExtensions, extensionCount{extension, count})
	}
	sort.Slice(topExtensions, func(i, j int) bool { return topExtensions[i].Count > topExtensions[j].Count })
	if len(topExtensions) > 15 {
		topExtensions = topExtensions[:15]
	}
	list := make([]string, 0, len(languages))
	for language := range languages {
		list = append(list, language)
	}
	sort.Strings(list)

	out := map[string]any{
		"root": root, "name": filepath.Base(root),
		"languages": list, "files": files, "directories": directories,
		"byExtension": topExtensions, "topLevel": topLevel,
		"writeEnabled": s.allowWrite,
		"truncated":    visited >= mcpOverviewEntries,
	}
	if home := java.ProjectJavaHome(root); home != "" {
		out["javaHome"] = home
		if jdk, ok := java.InspectJDK(home, "project"); ok {
			out["javaVersion"] = jdk.Version
		}
	}
	// OSGi details only when the folder really holds PDE bundles: indexing a huge target is
	// not something an overview should do for a non-OSGi project.
	if eclipsepde.HasBundles(root) {
		if report, _, err := s.osgiReport(root); err == nil {
			out["osgi"] = map[string]any{
				"bundles": report.Summary.Bundles, "resolved": report.Summary.Resolved,
				"installed": report.Summary.Bundles - report.Summary.Resolved,
				"lazy":      report.Summary.Lazy, "issues": report.Summary.Issues,
				"activators": len(report.Activators), "hasTarget": report.HasTarget,
				"targetPath": report.TargetPath, "targetBundles": report.TargetBundles,
				"runtime": report.Runtime != nil,
			}
			counts["diagnostics"] = len(report.Diagnostics)
		}
	}
	if len(counts) > 0 {
		out["counts"] = counts
	}
	return jsonText(out)
}

func (s *mcpServer) workspaceFindFiles(args mcpWorkspaceArgs) (string, error) {
	root, err := s.workspaceRoot(args.Workspace)
	if err != nil {
		return "", err
	}
	folder := root
	if strings.TrimSpace(args.Path) != "" {
		folder, err = secureWorkspacePath(root, args.Path)
		if err != nil {
			return "", err
		}
		info, statErr := os.Stat(folder)
		if statErr != nil || !info.IsDir() {
			return "", fmt.Errorf("%s is not a folder", args.Path)
		}
	}
	limit := args.Limit
	if limit <= 0 || limit > mcpFindLimit {
		limit = 100
	}
	query := strings.ToLower(strings.TrimSpace(args.Query))
	pattern := strings.TrimSpace(args.Pattern)
	if query == "" && pattern == "" {
		return "", fmt.Errorf("query or pattern is required")
	}
	var matches []map[string]any
	_ = filepath.WalkDir(folder, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() {
			if path != folder && ignoredWorkspaceDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		relative, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		slashed := filepath.ToSlash(relative)
		matched := query != "" && strings.Contains(strings.ToLower(slashed), query)
		if !matched && pattern != "" {
			matched, _ = filepath.Match(pattern, filepath.Base(path))
			if !matched {
				// A bare pattern such as *.java matches anywhere; a path pattern matches the
				// relative path.
				matched, _ = filepath.Match(filepath.FromSlash(pattern), slashed)
			}
		}
		if !matched {
			return nil
		}
		item := map[string]any{"path": slashed}
		if info, infoErr := entry.Info(); infoErr == nil {
			item["bytes"] = info.Size()
		}
		matches = append(matches, item)
		if len(matches) >= limit {
			return filepath.SkipAll
		}
		return nil
	})
	return jsonText(map[string]any{"total": len(matches), "limit": limit, "truncated": len(matches) >= limit, "files": matches})
}
