package goide

import "adomnia/internal/languages/golang"

type DebugMemory = golang.DebugMemory

var parseByteArray = golang.ParseByteArray

func (m *DebugManager) ReadMemory(id DebugSessionID, location string, length, frameID int) (DebugMemory, error) {
	return (&golang.DebugExtensions{Session: m.DebugManager}).ReadMemory(id, location, length, frameID)
}
