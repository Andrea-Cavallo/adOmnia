package adomniacli

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/build"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/sdk"
	"github.com/Andrea-Cavallo/adOmnia/internal/languagecatalog"
)

// systemToolchain resolves the toolchain a language adapter asks for from the machine PATH. The
// MCP server is headless: it never downloads an SDK, and a missing tool is a plan reason instead
// of a silent failure.
func systemToolchain(languageID string) (string, bool) {
	path, err := exec.LookPath(sdk.ExecutableName(languageID))
	if err != nil {
		return "", false
	}
	return path, true
}

// projectBuildPlan lists the detected build units and the exact command each one would run.
func (s *mcpServer) projectBuildPlan(requested string) (string, error) {
	root, err := s.workspaceRoot(requested)
	if err != nil {
		return "", err
	}
	plan, err := build.Detect(context.Background(), languagecatalog.NewRegistry(), root, build.Options{Toolchain: systemToolchain})
	if err != nil {
		return "", err
	}
	return jsonText(plan)
}

// projectBuild runs the build of the detected units and reports the tail of every output.
func (s *mcpServer) projectBuild(requested, task string, timeoutSeconds int, unitFilter string) (string, error) {
	root, err := s.workspaceRoot(requested)
	if err != nil {
		return "", err
	}
	plan, err := build.Detect(context.Background(), languagecatalog.NewRegistry(), root, build.Options{Task: task, Toolchain: systemToolchain})
	if err != nil {
		return "", err
	}
	if filter := strings.TrimSpace(unitFilter); filter != "" {
		plan.Units = filterBuildUnits(plan.Units, filter)
		if len(plan.Units) == 0 {
			return "", fmt.Errorf("no build unit matches %q", filter)
		}
	}
	if len(plan.Units) == 0 {
		return "", fmt.Errorf("no build unit detected in %s: supported projects are Gradle, Maven, Go modules, Cargo, npm/pnpm/yarn and the other language adapters", plan.Root)
	}
	results := plan.Execute(context.Background(), build.Options{Timeout: time.Duration(timeoutSeconds) * time.Second})
	ok := len(results) > 0
	for _, result := range results {
		if result.Status != build.StatusOK {
			ok = false
		}
	}
	return jsonText(map[string]any{"root": plan.Root, "ok": ok, "results": results})
}

// filterBuildUnits keeps the units whose name, kind or root contains the filter, so a monorepo
// builds one service without running everything.
func filterBuildUnits(units []build.Unit, filter string) []build.Unit {
	filter = strings.ToLower(filter)
	kept := make([]build.Unit, 0, len(units))
	for _, unit := range units {
		haystack := strings.ToLower(unit.Name + " " + unit.Kind + " " + unit.Language + " " + unit.Root)
		if strings.Contains(haystack, filter) {
			kept = append(kept, unit)
		}
	}
	return kept
}
