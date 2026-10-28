package java

import (
	"fmt"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"path/filepath"
	"strings"
)

// mavenCommand runs a lifecycle goal in the selected module, using the reactor wrapper when available.
func mavenCommand(request run.Request) (run.CommandSpec, error) {
	if !isFile(filepath.Join(request.WorkingDirectory, "pom.xml")) {
		return run.CommandSpec{}, fmt.Errorf("no pom.xml in the selected folder")
	}
	allowed := map[string]bool{"clean": true, "compile": true, "test": true, "package": true, "verify": true, "install": true}
	if len(request.ProgramArguments) == 0 {
		return run.CommandSpec{}, fmt.Errorf("select a Maven goal")
	}
	for _, goal := range request.ProgramArguments {
		if !allowed[goal] {
			return run.CommandSpec{}, fmt.Errorf("unsupported Maven goal: %s", goal)
		}
	}
	unit, _ := unitIn(request.WorkingDirectory)
	tool, ok := resolveBuildTool(unit)
	// Modules often share the reactor's wrapper. Stay inside the authorized project.
	for dir := filepath.Dir(unit.Root); (!ok || !strings.HasPrefix(tool.Target, "./")) && dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
		relative, err := filepath.Rel(request.Root, dir)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			break
		}
		candidate := unit
		candidate.Root = dir
		if found, exists := resolveBuildTool(candidate); exists && strings.HasPrefix(found.Target, "./") {
			tool = found
			unit = candidate
			ok = true
		}
		if dir == request.Root {
			break
		}
	}
	if !ok {
		return run.CommandSpec{}, fmt.Errorf("Maven is not installed and no project wrapper is available")
	}
	args := append([]string{"-B"}, request.ProgramArguments...)
	return run.CommandSpec{Executable: tool.resolve(unit), Arguments: args, WorkingDirectory: request.WorkingDirectory, Environment: request.Environment, DisplayCommand: tool.Label + " " + strings.Join(args, " ")}, nil
}
