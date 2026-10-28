package langserver

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/resources"
)

// EnableMemoryBudget starts the memory budget controller once; it samples only while a server runs.
func (m *LSPManager) EnableMemoryBudget(target uint64) {
	if m.memoryBudget != nil || target == 0 {
		return
	}
	b := &lspMemoryBudget{policy: resources.NewMemoryBudget(target), wake: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{})}
	m.memoryBudget = b
	go m.monitorMemoryBudget(b)
}

// Protect records that the user asked for this language server, without launching a process. The pin survives
// automatic restarts and is cleared by an explicit stop or close.
func (m *LSPManager) Protect(session Session, languageID string) error {
	if _, ok := m.languages.Get(languageID); !ok {
		return fmt.Errorf("unknown language")
	}
	state := m.ensure(session, languageID)
	state.mu.Lock()
	state.userInitiated = true
	state.mu.Unlock()
	return nil
}

// ImplementationMarkers computes the gutter markers of a document (I↑ and I↓ icons) in one pass.
func (m *LSPManager) ImplementationMarkers(ctx context.Context, sessionID SessionID, documentID DocumentID, relativePath string, semantics language.ImplementationMarkers) ([]ImplementationMarker, error) {
	ctx, cancel := context.WithTimeout(ctx, implementationMarkersTTL)
	defer cancel()
	symbols, _, err := m.DocumentSymbols(ctx, sessionID, documentID)
	if err != nil {
		return nil, err
	}
	markers := make([]ImplementationMarker, 0)
	for _, target := range implementationTargets(symbols, semantics) {
		if ctx.Err() != nil {
			break
		}
		locations, err := m.Locations(ctx, sessionID, documentID, "implementation", target.node.SelectionRange.StartLine, target.node.SelectionRange.StartColumn)
		if err != nil {
			continue
		}
		others := make([]EditorLocation, 0, len(locations))
		for _, location := range locations {
			if !sameLocation(location, relativePath, target.node) {
				others = append(others, location)
			}
		}
		if len(others) == 0 {
			continue
		}
		markers = append(markers, ImplementationMarker{
			Line: target.node.SelectionRange.StartLine, Column: target.node.SelectionRange.StartColumn,
			Name: target.node.Name, Direction: target.direction, Locations: others,
		})
	}
	return markers, nil
}

// HierarchyTokenURI returns the URI of a call/type hierarchy node token.
func HierarchyTokenURI(token string) (string, error) {
	var item hierarchyItem
	if err := json.Unmarshal([]byte(token), &item); err != nil || item.URI == "" {
		return "", fmt.Errorf("invalid hierarchy node")
	}
	return item.URI, nil
}

// ResourceTargets lists the running language server processes of a session for the resource monitor.
func (m *LSPManager) ResourceTargets(sessionID SessionID) []resources.Target {
	targets := []resources.Target{}
	for _, state := range m.servers(sessionID) {
		state.mu.Lock()
		if state.status.PID > 0 {
			limit := ""
			for _, value := range state.options.Environment {
				if strings.HasPrefix(strings.ToUpper(value), "GOMEMLIMIT=") {
					limit = strings.SplitN(value, "=", 2)[1]
				}
			}
			targets = append(targets, resources.Target{PID: state.status.PID, Name: state.options.DisplayName(), Workspace: state.root, SessionID: string(sessionID), Role: "language-server", Owner: "Code Studio / " + state.options.DisplayName(), MemoryLimit: limit})
		}
		state.mu.Unlock()
	}
	return targets
}

// ObserveMemoryBudget feeds a resource snapshot to the memory budget and returns its status, or nil when no
// budget is enabled.
func (m *LSPManager) ObserveMemoryBudget(snapshot resources.Snapshot) *resources.BudgetStatus {
	b := m.memoryBudget
	if b == nil {
		return nil
	}
	if len(snapshot.Processes) > 0 && snapshot.Processes[0].RAM > 0 {
		b.policy.Observe(snapshot.RAM)
	}
	status := b.policy.Status()
	return &status
}

// UserPinned reports whether the user explicitly started the language server of a session (it is then never
// released automatically).
func (m *LSPManager) UserPinned(sessionID SessionID, languageID string) bool {
	state, ok := m.server(sessionID, languageID)
	if !ok {
		return false
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.userInitiated
}
