package golang

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"adomnia/internal/ide/graph"
)

func TestEnvAndConfigReads(t *testing.T) {
	report, root := loadFixture(t, map[string]string{
		"go.mod":                     "module example.com/cfg\n\ngo 1.22\n\nrequire github.com/spf13/viper v0.0.0\n\nreplace github.com/spf13/viper => ./third_party/viper\n",
		"third_party/viper/go.mod":   "module github.com/spf13/viper\n\ngo 1.22\n",
		"third_party/viper/viper.go": "package viper\n\nfunc GetString(key string) string { return \"\" }\n",
		"app/app.go": `package app

import (
	"os"

	"github.com/spf13/viper"
)

const dsnKey = "DATABASE_URL"

func DSN() string { return os.Getenv(dsnKey) }

func Port() string { return viper.GetString("server.port") }

func Start() string { return DSN() + Port() }
`,
		"app/app_test.go": "package app\n\nimport \"testing\"\n\nfunc TestStart(t *testing.T) { _ = Start() }\n",
	})
	keys := map[string]string{}
	for _, read := range report.Reads {
		keys[read.Kind+":"+read.Key] = read.Function
	}
	if keys["env:DATABASE_URL"] != "DSN" || keys["config:server.port"] != "Port" {
		t.Fatalf("reads: %v", keys)
	}
	report.Resolve(func(path string, offset int) (string, int, int) {
		data, _ := os.ReadFile(path)
		rel, _ := filepath.Rel(root, path)
		return filepath.ToSlash(rel), bytes.Count(data[:min(offset, len(data))], []byte("\n")) + 1, 1
	})
	g := GraphFromArchitecture(report).Graph()
	index := graph.NewIndex(&g)
	impact, ok := index.Impact("env:DATABASE_URL")
	if !ok || refLabels(impact.Tests) != "app.TestStart" || refLabels(impact.Callers) != "app.DSN,app.Start" {
		t.Fatalf("env impact: callers %s tests %s", refLabels(impact.Callers), refLabels(impact.Tests))
	}
	start, _ := index.Impact("fn:example.com/cfg/app.Port")
	if refLabels(start.Reads) != "server.port" {
		t.Fatalf("Port reads: %s", refLabels(start.Reads))
	}
}
