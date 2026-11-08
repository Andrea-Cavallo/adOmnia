package java

import (
	"encoding/xml"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/project"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

const (
	antBuildFile = "build.xml"
	// maxAntTargets keeps the Run list readable on generated build files with hundreds of targets.
	maxAntTargets = 40
	// antBatch is the Windows launcher, a .bat: target names that cmd.exe would mangle are skipped.
	antBatch = "ant.bat"
)

// Target names that mean a test or a run rather than a build, by Ant convention.
var (
	antTestTargets = []string{"test", "tests", "junit", "unit-test", "unittest", "test-all"}
	antRunTargets  = []string{"run", "start", "launch", "exec", "execute", "deploy", "run-app"}
)

// antProject is the part of build.xml that describes the project and its targets.
type antProject struct {
	XMLName xml.Name    `xml:"project"`
	Name    string      `xml:"name,attr"`
	Default string      `xml:"default,attr"`
	Targets []antTarget `xml:"target"`
}

type antTarget struct {
	Name        string `xml:"name,attr"`
	Description string `xml:"description,attr"`
}

// readAntProject reads build.xml; ok is false when the file is not an Ant project.
func readAntProject(path string) (antProject, bool) {
	data, err := readLimited(path)
	if err != nil {
		return antProject{}, false
	}
	var parsed antProject
	if err := xml.Unmarshal(data, &parsed); err != nil || parsed.XMLName.Local != "project" {
		return antProject{}, false
	}
	return parsed, true
}

// antUnitIn recognizes an Ant project in the folder. Maven and Gradle win: there build.xml is a helper.
func antUnitIn(directory string) (project.Unit, bool) {
	manifest := filepath.Join(directory, antBuildFile)
	if !isFile(manifest) {
		return project.Unit{}, false
	}
	parsed, ok := readAntProject(manifest)
	if !ok {
		return project.Unit{}, false
	}
	name := strings.TrimSpace(parsed.Name)
	if name == "" {
		name = filepath.Base(directory)
	}
	return project.Unit{Language: ID, Kind: UnitAnt, Root: directory, Name: name, Manifest: manifest}, true
}

// resolveAnt finds Ant on PATH (saved by name, so a configuration shared through Git works on every
// machine), then in ANT_HOME/bin.
func resolveAnt() (buildTool, bool) {
	if _, err := lookPath("ant"); err == nil {
		return buildTool{Target: "ant", Label: "ant"}, true
	}
	if home := strings.TrimSpace(os.Getenv("ANT_HOME")); home != "" {
		if candidate := filepath.Join(home, "bin", antScript()); isFile(candidate) {
			return buildTool{Target: candidate, Label: "ant"}, true
		}
	}
	return buildTool{}, false
}

func antScript() string {
	if runtime.GOOS == "windows" {
		return "ant.bat"
	}
	return "ant"
}

// publicAntTargets are the targets a user runs: private ones (leading "-", Ant's convention) are
// skipped, the default target comes first, the list is capped.
func publicAntTargets(parsed antProject) []antTarget {
	targets := make([]antTarget, 0, len(parsed.Targets))
	for _, target := range parsed.Targets {
		name := strings.TrimSpace(target.Name)
		if name == "" || strings.HasPrefix(name, "-") || run.CheckBatchSafe(antBatch, []string{name}) != nil {
			continue
		}
		target.Name = name
		if name == parsed.Default {
			targets = slices.Insert(targets, 0, target)
			continue
		}
		targets = append(targets, target)
	}
	if len(targets) > maxAntTargets {
		targets = targets[:maxAntTargets]
	}
	return targets
}

// antAction maps a target to the Run panel group it belongs to.
func antAction(name string) string {
	lower := strings.ToLower(name)
	switch {
	case slices.Contains(antTestTargets, lower):
		return "test"
	case slices.Contains(antRunTargets, lower):
		return "run"
	default:
		return "build"
	}
}

// antSuggestions proposes one command configuration per public target. -noinput keeps an <input>
// task from waiting forever on a console nobody types into.
func antSuggestions(unit project.Unit) []run.Suggestion {
	tool, ok := resolveAnt()
	if !ok {
		return nil
	}
	parsed, ok := readAntProject(unit.Manifest)
	if !ok {
		return nil
	}
	targets := publicAntTargets(parsed)
	suggestions := make([]run.Suggestion, 0, len(targets)+maxMainClasses)
	for _, target := range targets {
		title := "Ant · ant " + target.Name
		if target.Name == parsed.Default {
			title += " (default)"
		}
		if description := strings.TrimSpace(target.Description); description != "" {
			title += " · " + description
		}
		suggestions = append(suggestions, run.Suggestion{
			ID: ID + "|" + unit.Root + "|ant:" + target.Name, Language: ID, Action: antAction(target.Name), UnitRoot: unit.Root,
			Title: title,
			Configuration: run.Configuration{
				Language: ID, Name: "Ant " + target.Name, Kind: "command",
				Target: tool.Target, ProgramArguments: []string{"-noinput", target.Name},
			},
		})
	}
	return append(suggestions, antMainSuggestions(unit)...)
}

// antSourceFolders are where an Ant project keeps its sources: the Eclipse .classpath when there is one
// (Kepler projects have it), else the usual src and JavaSource.
func antSourceFolders(unitRoot string) []string {
	if folders := EclipseSourceFolders(unitRoot); len(folders) > 0 {
		return folders
	}
	var folders []string
	for _, name := range []string{"src", "JavaSource", "source"} {
		if folder := filepath.Join(unitRoot, name); isDirectory(folder) {
			folders = append(folders, folder)
		}
	}
	return folders
}

// antMainSuggestions propose the main classes of an Ant project. They run through the Java language
// server, which knows the classpath of the project (Ant itself has no model of it).
func antMainSuggestions(unit project.Unit) []run.Suggestion {
	var suggestions []run.Suggestion
	for _, class := range mainClassesIn(antSourceFolders(unit.Root)) {
		suggestions = append(suggestions, mainSuggestion(unit, suggestEntry{action: "run", id: ":" + class, main: &mainClass{Module: unit.Root, Class: class}}))
	}
	return suggestions
}

// mainClassesIn scans source folders for `public static void main`, within the same limits as Maven.
// fallback: JDT decide quando è ready (JS-6) — a suggestion from the text of the files, nothing more.
func mainClassesIn(folders []string) []string {
	var classes []string
	scanned := 0
	for _, folder := range folders {
		_ = filepath.WalkDir(folder, func(path string, entry fs.DirEntry, err error) error {
			if err != nil || entry.IsDir() || !strings.HasSuffix(entry.Name(), ".java") {
				return nil
			}
			if scanned++; scanned > maxMainScanFiles || len(classes) >= maxMainClasses {
				return filepath.SkipAll
			}
			if class, ok := mainClassOf(path); ok && !slices.Contains(classes, class) {
				classes = append(classes, class)
			}
			return nil
		})
	}
	slices.Sort(classes)
	return classes
}

// mainClassOf reads package and main of one source with the local regexes.
// fallback: JDT decide quando è ready (JS-6) — no semantics beyond the text of the file.
func mainClassOf(path string) (string, bool) {
	info, err := os.Stat(path)
	if err != nil || info.Size() > maxMainSourceKB<<10 {
		return "", false
	}
	data, err := os.ReadFile(path) // #nosec G304 -- a source file of the opened project
	if err != nil || !mainMethod.Match(data) {
		return "", false
	}
	name := strings.TrimSuffix(filepath.Base(path), ".java")
	if match := packageLine.FindSubmatch(data); match != nil {
		name = string(match[1]) + "." + name
	}
	return name, true
}
