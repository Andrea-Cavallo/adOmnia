package golang

import (
	"adomnia/internal/ide/run"
	"adomnia/internal/jsonutil"
	"path/filepath"
	"testing"
)

func TestRunnerConfinesOpaqueGoOptions(t *testing.T) {
	root := t.TempDir()
	for _, options := range []RunOptions{
		{ExtraTargets: []string{"../outside.go"}},
		{GoArguments: []string{"-o", filepath.Join(root, "..", "outside.exe")}},
		{ExtraTargets: []string{"-overlay=outside.json"}},
	} {
		encoded, _ := jsonutil.Marshal(options)
		if _, err := New().CommandSpec(run.Request{Kind: "run", Root: root, WorkingDirectory: root, Target: ".", Executable: "go", LanguageOptions: encoded}); err == nil {
			t.Fatalf("unsafe options accepted: %+v", options)
		}
	}
}
