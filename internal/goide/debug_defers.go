package goide

import "adomnia/internal/languages/golang"

type PendingDefer = golang.PendingDefer

func (m *DebugManager) PendingDefers(id DebugSessionID, threadID int) ([]PendingDefer, error) {
	return (&golang.DebugExtensions{Session: m.DebugManager}).PendingDefers(id, threadID)
}
func (s *Service) DebugPendingDefers(debugID string, threadID int) ([]PendingDefer, error) {
	return s.debug.PendingDefers(DebugSessionID(debugID), threadID)
}
