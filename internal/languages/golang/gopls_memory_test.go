package golang

import (
	"strings"
	"testing"
)

func TestExplicitGoplsLimitOverridesInheritedWithoutMutatingEnvironment(t *testing.T) {
	env := []string{"PATH=local", "GOMEMLIMIT=2GiB", "gomemlimit=1GiB"}
	spec := GoplsServerSpec(GoplsInfo{Binary: "gopls"}, env, GoplsSettings{MemoryLimitMiB: 512})
	found := 0
	for _, entry := range spec.Environment {
		if strings.HasPrefix(strings.ToUpper(entry), "GOMEMLIMIT=") {
			found++
			if entry != "GOMEMLIMIT=512MiB" {
				t.Fatal(entry)
			}
		}
	}
	if found != 1 || env[1] != "GOMEMLIMIT=2GiB" {
		t.Fatal("override or caller environment corrupted")
	}
}
