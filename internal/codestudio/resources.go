package codestudio

import "github.com/Andrea-Cavallo/adOmnia/internal/resources"

func (s *Service) ResourceUsage() resources.Snapshot {
	targets := []resources.Target{}
	for _, session := range s.workspace.ListSessions() {
		targets = append(targets, s.lsp.ResourceTargets(session.ID)...)
		for _, execution := range s.processes.List(session.ID) {
			if execution.PID > 0 && execution.Status == "running" {
				targets = append(targets, resources.Target{PID: execution.PID, Name: execution.Kind, Workspace: execution.WorkingDirectory, SessionID: string(session.ID), Role: "run-task", Owner: "Code Studio / " + execution.Kind + " / " + string(execution.ID)})
			}
		}
	}
	snapshot := resources.Sample(targets)
	snapshot.Budget = s.lsp.ObserveMemoryBudget(snapshot)
	return snapshot
}
