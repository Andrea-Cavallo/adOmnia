package codestudio

import (
	"adomnia/internal/resources"
	"strings"
)

func (s *Service) ResourceUsage() resources.Snapshot {
	targets := []resources.Target{}
	for _, session := range s.workspace.ListSessions() {
		for _, state := range s.lsp.servers(session.ID) {
			state.mu.Lock()
			if state.status.PID > 0 {
				limit := ""
				for _, value := range state.options.Environment {
					if strings.HasPrefix(strings.ToUpper(value), "GOMEMLIMIT=") {
						limit = strings.SplitN(value, "=", 2)[1]
					}
				}
				targets = append(targets, resources.Target{PID: state.status.PID, Name: state.options.DisplayName(), Workspace: session.Project.RealPath, SessionID: string(session.ID), Role: "language-server", Owner: "Code Studio / " + state.options.DisplayName(), MemoryLimit: limit})
			}
			state.mu.Unlock()
		}
		for _, execution := range s.processes.List(session.ID) {
			if execution.PID > 0 && execution.Status == "running" {
				targets = append(targets, resources.Target{PID: execution.PID, Name: execution.Kind, Workspace: execution.WorkingDirectory, SessionID: string(session.ID), Role: "run-task", Owner: "Code Studio / " + execution.Kind + " / " + string(execution.ID)})
			}
		}
	}
	snapshot := resources.Sample(targets)
	if b := s.lsp.memoryBudget; b != nil {
		if len(snapshot.Processes) > 0 && snapshot.Processes[0].RAM > 0 {
			b.policy.Observe(snapshot.RAM)
		}
		status := b.policy.Status()
		snapshot.Budget = &status
	}
	return snapshot
}
