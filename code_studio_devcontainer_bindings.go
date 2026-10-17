package main

import "adomnia/internal/codestudio"

func (g *GoIDE) StartDevContainer(sessionID string) (codestudio.Execution, error) {
	return g.service.StartDevContainer(sessionID)
}
