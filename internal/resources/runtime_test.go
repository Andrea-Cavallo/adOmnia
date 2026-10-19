package resources

import (
	"os"
	"path/filepath"
	"runtime/debug"
	"testing"
)

func TestInitialMemoryLimitHonorsExplicitEnvironment(t *testing.T) {
	old := debug.SetMemoryLimit(2 << 30)
	t.Cleanup(func() { debug.SetMemoryLimit(old) })
	t.Setenv("GOMEMLIMIT", "2GiB")
	if initialMemoryLimit() != 2<<30 {
		t.Fatal("explicit startup limit lost")
	}
	t.Setenv("GOMEMLIMIT", "")
	if initialMemoryLimit() != 512<<20 {
		t.Fatal("missing safe backend default")
	}
}

func TestRuntimeLimitPersistsAndAppliesLive(t *testing.T) {
	old := debug.SetMemoryLimit(-1)
	previousPath := runtimeConfig.path
	t.Cleanup(func() { debug.SetMemoryLimit(old); runtimeConfig.path = previousPath })
	path := filepath.Join(t.TempDir(), "resources.json")
	if err := ConfigureRuntime(path); err != nil {
		t.Fatal(err)
	}
	for _, mib := range []int{256, 512, 0} {
		state, err := SetRuntimeMemoryLimit(mib)
		if err != nil {
			t.Fatal(err)
		}
		want := runtimeConfig.initial
		if mib != 0 {
			want = int64(mib) << 20
		}
		if state.MemoryLimit != want {
			t.Fatalf("limit %d, want %d", state.MemoryLimit, want)
		}
		if err := ConfigureRuntime(path); err != nil {
			t.Fatal(err)
		}
		if debug.SetMemoryLimit(-1) != want {
			t.Fatal("restart restore failed")
		}
	}
	if _, err := SetRuntimeMemoryLimit(1); err == nil {
		t.Fatal("accepted dangerous tiny limit")
	}
	if err := os.WriteFile(path, []byte(`{"goMemoryLimitMiB":-1}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ConfigureRuntime(path); err == nil {
		t.Fatal("invalid persisted setting accepted")
	}
	if debug.SetMemoryLimit(-1) != runtimeConfig.initial {
		t.Fatal("invalid setting changed active runtime")
	}
	runtimeConfig.path = t.TempDir() // a directory cannot be replaced with the settings file
	if _, err := SetRuntimeMemoryLimit(256); err == nil {
		t.Fatal("storage failure was hidden")
	}
	if debug.SetMemoryLimit(-1) != runtimeConfig.initial {
		t.Fatal("failed persistence changed the live limit")
	}
}
