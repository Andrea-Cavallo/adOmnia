package goide

import "adomnia/internal/languages/golang"

type GoroutineCreation = golang.GoroutineCreation

func (m *DebugManager) GoroutineCreation(id DebugSessionID, threadID int) (GoroutineCreation, error) {
	return (&golang.DebugExtensions{Session: m.DebugManager}).GoroutineCreation(id, threadID)
}
func (s *Service) DebugGoroutineCreation(debugID string, threadID int) (GoroutineCreation, error) {
	return s.debug.GoroutineCreation(DebugSessionID(debugID), threadID)
}
