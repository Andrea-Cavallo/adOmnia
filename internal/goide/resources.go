package goide

import "adomnia/internal/resources"

func (s *Service) ResourceUsage() resources.Snapshot {
	targets := []resources.Target{}
	for _, session := range s.workspace.ListSessions() {
		for _, state := range s.lsp.servers(session.ID) {
			state.mu.Lock()
			if state.status.PID > 0 {
				targets = append(targets, resources.Target{PID: state.status.PID, Name: state.options.DisplayName(), Workspace: session.Project.RealPath})
			}
			state.mu.Unlock()
		}
	}
	return resources.Sample(targets)
}
