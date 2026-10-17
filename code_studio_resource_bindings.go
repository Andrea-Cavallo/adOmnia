package main

import "adomnia/internal/resources"

func (g *GoIDE) ResourceUsage() resources.Snapshot { return g.service.ResourceUsage() }
