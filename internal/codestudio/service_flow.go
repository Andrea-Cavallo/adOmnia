package codestudio

import (
	"errors"
	"sync"

	"github.com/Andrea-Cavallo/adOmnia/internal/flowintel"
)

// flowIndexes caches the Flow Intelligence graph per session: discovery walks the sources, the
// queries are then instant. Writes and explicit refreshes drop it.
var flowIndexes sync.Map

// flowIndex returns the cached index or discovers it.
func (s *Service) flowIndex(sessionID string, refresh bool) (*flowintel.Index, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return nil, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return nil, errors.New("explicitly authorize the tools for this project")
	}
	if !refresh {
		if cached, ok := flowIndexes.Load(session.ID); ok {
			if index, valid := cached.(*flowintel.Index); valid {
				return index, nil
			}
		}
	}
	discovery, err := flowintel.Discover(session.Project.RealPath)
	if err != nil {
		return nil, err
	}
	index := flowintel.NewIndex(discovery)
	flowIndexes.Store(session.ID, index)
	return index, nil
}

// invalidateFlow drops the cached flow graph of a session.
func (s *Service) invalidateFlow(sessionID SessionID) {
	flowIndexes.Delete(sessionID)
}

// FlowOverview lists the flows/subflows of the project and what the engine found.
func (s *Service) FlowOverview(sessionID string, refresh bool) (*flowintel.Overview, error) {
	index, err := s.flowIndex(sessionID, refresh)
	if err != nil {
		return nil, err
	}
	return index.Overview(), nil
}

// FlowSearch filters the flow/subflow entries by text and bundle.
func (s *Service) FlowSearch(sessionID, query, bundle string, limit int) ([]flowintel.FlowEntry, error) {
	index, err := s.flowIndex(sessionID, false)
	if err != nil {
		return nil, err
	}
	return index.SearchFlows(query, bundle, limit), nil
}

// FlowTrace walks a flow, subflow or method down or up the execution graph.
func (s *Service) FlowTrace(sessionID, id, direction string, depth int) (*flowintel.Trace, error) {
	index, err := s.flowIndex(sessionID, false)
	if err != nil {
		return nil, err
	}
	return index.Trace(id, direction, depth)
}

// FlowFindPaths finds execution paths between two nodes.
func (s *Service) FlowFindPaths(sessionID, from, to string, depth, limit int) ([]flowintel.Path, error) {
	index, err := s.flowIndex(sessionID, false)
	if err != nil {
		return nil, err
	}
	return index.FindPaths(from, to, depth, limit)
}

// FlowImpact lists the flows, bundles, services and external systems a change can break.
func (s *Service) FlowImpact(sessionID, id string, depth int) (*flowintel.Impact, error) {
	index, err := s.flowIndex(sessionID, false)
	if err != nil {
		return nil, err
	}
	return index.Impact(id, depth)
}

// FlowExplain explains one node: relations, confidence and the source snippet.
func (s *Service) FlowExplain(sessionID, id string) (*flowintel.Explanation, error) {
	index, err := s.flowIndex(sessionID, false)
	if err != nil {
		return nil, err
	}
	return index.Explain(id)
}

// FlowRuntime correlates the running Equinox framework with the flow graph: ACTIVE bundles,
// registered services and consumers. The runtime must already be started from the OSGi panel.
func (s *Service) FlowRuntime(sessionID string) (*flowintel.RuntimeEvidence, error) {
	index, err := s.flowIndex(sessionID, false)
	if err != nil {
		return nil, err
	}
	snapshot, err := s.JavaOsgiRuntimeSnapshot(sessionID)
	if err != nil {
		return nil, errors.New(err.Error() + ": start the runtime from the OSGi Control Center › Runtime first")
	}
	return index.ObserveRuntime(snapshot), nil
}
