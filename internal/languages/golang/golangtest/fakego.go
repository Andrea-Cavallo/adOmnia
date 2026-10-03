// Package golangtest offre ai test un SDK Go finto (version immediata, env lento a comando),
// condiviso dai test dell'adapter Go e da quelli d'integrazione dell'host.
package golangtest

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
)

// fakeGoSource è un `go` finto: version risponde subito, env dorme FAKE_GO_ENV_SLEEP e annota la cartella di lavoro.
const fakeGoSource = `package main

import (
	"fmt"
	"os"
	"time"
)

func main() {
	wd, _ := os.Getwd()
	if log := os.Getenv("FAKE_GO_LOG"); log != "" {
		f, _ := os.OpenFile(log, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		fmt.Fprintf(f, "%s|%s|%s\n", os.Args[1], wd, os.Getenv("GOTOOLCHAIN"))
		f.Close()
	}
	switch os.Args[1] {
	case "version":
		fmt.Println("go version go1.26.0 fake/amd64")
	case "env":
		if d, err := time.ParseDuration(os.Getenv("FAKE_GO_ENV_SLEEP")); err == nil {
			time.Sleep(d)
		}
		for _, key := range os.Args[2:] {
			switch key {
			case "GOPATH":
				fmt.Println("/fake/gopath")
			case "GOPROXY":
				fmt.Println(os.Getenv("GOPROXY"))
			case "GOTOOLCHAIN":
				fmt.Println("auto")
			default:
				fmt.Println("")
			}
		}
	}
}
`

var buildFakeGoOnce sync.Once
var fakeGoBuilt string

// FakeSDK crea <root>/bin/go(.exe) e, se withVersionFile, <root>/VERSION come in un SDK ufficiale.
func FakeSDK(t *testing.T, withVersionFile bool) string {
	t.Helper()
	buildFakeGoOnce.Do(func() {
		dir, err := os.MkdirTemp("", "fakego")
		if err != nil {
			return
		}
		source := filepath.Join(dir, "main.go")
		_ = os.WriteFile(source, []byte(fakeGoSource), 0o644)
		output := filepath.Join(dir, "go"+ExeSuffix())
		build := exec.Command("go", "build", "-o", output, source)
		build.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOFLAGS=")
		if out, err := build.CombinedOutput(); err == nil {
			fakeGoBuilt = output
		} else {
			t.Logf("build fake go: %v %s", err, out)
		}
	})
	if fakeGoBuilt == "" {
		t.Skip("impossibile compilare il go finto")
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(fakeGoBuilt)
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(root, "bin", "go"+ExeSuffix())
	if err := os.WriteFile(binary, data, 0o755); err != nil {
		t.Fatal(err)
	}
	if withVersionFile {
		if err := os.WriteFile(filepath.Join(root, "VERSION"), []byte("go1.26.0\ntime 2026-01-01T00:00:00Z\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return binary
}

func ExeSuffix() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}
