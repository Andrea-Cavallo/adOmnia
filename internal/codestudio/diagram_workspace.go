package codestudio

import (
	"errors"

	"github.com/Andrea-Cavallo/adOmnia/internal/diagrams"
)

// Diagram Studio reads this: one normalized view of the workspace, built from the graphs the
// language adapters already index. It never scans sources a second time, so opening a diagram costs
// the same as the Architecture Explorer and the Flow Explorer, and their caches are shared.

// DiagramWorkspace returns the entities and relations of a session as Diagram Studio consumes them.
// `refresh` rebuilds both the Semantic Workspace Graph and the Flow Intelligence index.
func (s *Service) DiagramWorkspace(sessionID string, refresh bool) (diagrams.WorkspaceAnalysis, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return diagrams.WorkspaceAnalysis{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return diagrams.WorkspaceAnalysis{}, errors.New("Trust this project in Code Studio first: the analysis only runs for a trusted project")
	}
	root := session.Project.RealPath
	input := diagrams.WorkspaceInput{Root: root}

	if entry, _, graphErr := s.workspaceGraph(sessionID, refresh); graphErr == nil {
		semantic := entry.graph
		input.Semantic = &semantic
	} else {
		input.Problems = append(input.Problems, "Go analysis: "+graphErr.Error())
	}

	// Flow Intelligence covers Java, XML and OSGi; on a Go-only workspace it simply finds nothing.
	if index, flowErr := s.flowIndex(sessionID, refresh); flowErr == nil {
		input.Flows = index.Discovery
	} else {
		input.Problems = append(input.Problems, "Flow analysis: "+flowErr.Error())
	}

	return diagrams.BuildWorkspace(input), nil
}
