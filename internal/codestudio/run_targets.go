package codestudio

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"adomnia/internal/ide/language"
	"adomnia/internal/ide/run"
	"adomnia/internal/languages/golang"
)

// ListRunTargets returns runnable packages discovered by the registered
// language adapters for this project. Each build unit is queried separately so
// go.work and nested modules retain their own working directory.
func (s *Service) ListRunTargets(sessionID string) ([]run.RunTarget, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	targets := make([]run.RunTarget, 0)
	seenUnits := make(map[string]bool)
	for _, unit := range session.Project.Units {
		adapter, ok := s.workspace.languages.Get(unit.Language)
		if !ok {
			continue
		}
		resolver, ok := adapter.(language.RunTargetResolver)
		if !ok || unit.Kind == golang.UnitWorkspace {
			continue
		}
		key := strings.ToLower(filepath.Clean(unit.Root))
		if seenUnits[key] {
			continue
		}
		seenUnits[key] = true
		found, discoverErr := resolver.DiscoverRunTargets(ctx, unit.Root)
		if discoverErr != nil {
			return nil, fmt.Errorf("discover %s run targets: %w", unit.Language, discoverErr)
		}
		targets = append(targets, found...)
	}
	sort.Slice(targets, func(i, j int) bool {
		if targets[i].ModuleDir == targets[j].ModuleDir {
			return targets[i].Package < targets[j].Package
		}
		return targets[i].ModuleDir < targets[j].ModuleDir
	})
	return targets, nil
}

func (s *Service) resolveLanguageRunTarget(session Session, languageID, kind, workingDirectory, target string) (string, string, error) {
	if languageID == "" {
		languageID = golang.ID
	}
	adapter, ok := s.workspace.languages.Get(languageID)
	if !ok {
		return "", "", fmt.Errorf("language not registered: %s", languageID)
	}
	if _, ok := adapter.(language.RunTargetResolver); !ok {
		return workingDirectory, target, nil
	}
	// An empty/non-language folder may still run a user-provided toolchain or a
	// file created after the last project refresh. Preserve the old explicit
	// request until the adapter has identified at least one unit.
	hasUnit := false
	for _, unit := range session.Project.Units {
		if unit.Language == languageID {
			hasUnit = true
			break
		}
	}
	if !hasUnit {
		return workingDirectory, target, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), runTargetDiscoveryTimeout)
	defer cancel()
	resolved, err := run.ResolveTarget(ctx, adapter, run.Request{Root: session.Project.RealPath, WorkingDirectory: workingDirectory, Target: target, Kind: kind})
	if err != nil {
		return "", "", err
	}
	return resolved.WorkingDirectory, resolved.Target, nil
}

const runTargetDiscoveryTimeout = 45 * time.Second
