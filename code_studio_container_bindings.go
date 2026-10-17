package main

import "adomnia/internal/codestudio"

func (g *GoIDE) InspectContainer(sessionID, name string) (codestudio.ContainerInfo, error) {
	return g.service.InspectContainer(sessionID, name)
}
