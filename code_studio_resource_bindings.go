package main

import "adomnia/internal/resources"

func (g *GoIDE) ResourceUsage() resources.Snapshot { return g.service.ResourceUsage() }

func (g *GoIDE) SetBackendMemoryLimit(mib int) (resources.GoRuntime, error) {
	return resources.SetRuntimeMemoryLimit(mib)
}
