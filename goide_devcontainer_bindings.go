package main

import "adomnia/internal/goide"

func (g *GoIDE) StartDevContainer(sessionID string) (goide.Execution, error) {
	return g.service.StartDevContainer(sessionID)
}
