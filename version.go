package main

import "runtime/debug"

// Release builds set Version with -ldflags "-X main.Version=…". A plain `go install
// github.com/Andrea-Cavallo/adOmnia@vX.Y.Z` has no ldflags: take the module version Go stamps in the binary.
func init() {
	if Version != "dev" {
		return
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		Version = moduleVersion(info.Main.Version)
	}
}

// moduleVersion keeps "dev" for local builds, which Go stamps as "(devel)" or leaves empty.
func moduleVersion(stamped string) string {
	if stamped == "" || stamped == "(devel)" {
		return "dev"
	}
	return stamped
}
