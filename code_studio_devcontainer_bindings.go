package main

import "github.com/Andrea-Cavallo/adOmnia/internal/codestudio"

func (g *GoIDE) StartDevContainer(sessionID string) (codestudio.Execution, error) {
	return g.service.StartDevContainer(sessionID)
}
