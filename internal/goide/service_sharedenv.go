package goide

import (
	"regexp"
	"sync"
)

// sharedEnvironment holds the variables of the active adOmnia environment, pushed
// by the renderer. Every run receives them as process environment; the run's own
// entries win and may reference them as {{NAME}}.
type sharedEnvironment struct {
	mu   sync.RWMutex
	vars map[string]string
}

var (
	envNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	envRefPattern  = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)
)

// SetSharedEnvironment replaces the adOmnia environment variables applied to runs.
// Names that are not valid process-environment names are ignored.
func (s *Service) SetSharedEnvironment(vars map[string]string) {
	next := make(map[string]string, len(vars))
	for key, value := range vars {
		if envNamePattern.MatchString(key) {
			next[key] = value
		}
	}
	s.sharedEnv.mu.Lock()
	s.sharedEnv.vars = next
	s.sharedEnv.mu.Unlock()
}

// withSharedEnvironment returns a new map: shared variables first, then the run's
// own entries with {{NAME}} references resolved against the shared variables.
func (s *Service) withSharedEnvironment(own map[string]string) map[string]string {
	s.sharedEnv.mu.RLock()
	shared := s.sharedEnv.vars
	s.sharedEnv.mu.RUnlock()
	if len(shared) == 0 {
		return own
	}
	merged := make(map[string]string, len(shared)+len(own))
	for key, value := range shared {
		merged[key] = value
	}
	for key, value := range own {
		merged[key] = envRefPattern.ReplaceAllStringFunc(value, func(token string) string {
			name := envRefPattern.FindStringSubmatch(token)[1]
			if resolved, ok := shared[name]; ok {
				return resolved
			}
			return token
		})
	}
	return merged
}
