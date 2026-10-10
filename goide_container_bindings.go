package main

import "adomnia/internal/goide"

func (g *GoIDE) InspectContainer(sessionID, name string) (goide.ContainerInfo, error) {
	return g.service.InspectContainer(sessionID, name)
}
