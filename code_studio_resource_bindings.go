package main

import "github.com/Andrea-Cavallo/adOmnia/internal/resources"

func (g *GoIDE) ResourceUsage() resources.Snapshot { return g.service.ResourceUsage() }

// ResetResourceBaseline reopens the CPU measurement window before a recording,
// so the first sample does not carry CPU spent before it.
func (g *GoIDE) ResetResourceBaseline() { resources.ResetBaseline() }

// ResourceEnvironment describes the machine and build an exported report came
// from: hardware and version are what make the numbers comparable.
func (g *GoIDE) ResourceEnvironment() resources.Environment {
	environment := resources.HostEnvironment()
	environment.AppVersion = Version
	environment.BuildDate = BuildDate
	environment.GitCommit = GitCommit
	return environment
}

func (g *GoIDE) SetBackendMemoryLimit(mib int) (resources.GoRuntime, error) {
	return resources.SetRuntimeMemoryLimit(mib)
}
