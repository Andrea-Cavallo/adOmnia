package declared

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

func TestNativeExecutableRunsAndDebugsOnlyInsideTheProject(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "build"), 0o755); err != nil {
		t.Fatal(err)
	}
	program := filepath.Join(root, "build", "app")
	if err := os.WriteFile(program, []byte("bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "evil")
	if err := os.WriteFile(outside, []byte("bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	var cpp nativeAdapter
	for _, l := range Languages() {
		if l.ID() == "cpp" {
			cpp = l.(nativeAdapter)
		}
		_, runs := l.(language.Runner)
		_, debugs := l.(dap.DebugAdapterProvider)
		if native := l.ID() == "cpp" || l.ID() == "objective-c" || l.ID() == "zig" || l.ID() == "swift"; runs != native || debugs != native {
			t.Fatalf("%s: runs=%v debugs=%v", l.ID(), runs, debugs)
		}
	}

	spec, err := cpp.CommandSpec(run.Request{Kind: KindExecutable, Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"program":"build/app"}`), ProgramArguments: []string{"--port", "8080"}})
	if err != nil || !strings.HasSuffix(spec.Executable, filepath.Join("build", "app")) || len(spec.Arguments) != 2 {
		t.Fatalf("run: %+v %v", spec, err)
	}
	for _, options := range []string{`{"program":"` + filepath.ToSlash(outside) + `"}`, `{"program":"../x"}`, `{"program":"build"}`, `{}`, `{"program":"-rf"}`} {
		if _, err := cpp.CommandSpec(run.Request{Kind: KindExecutable, Root: root, WorkingDirectory: root, LanguageOptions: []byte(options)}); err == nil {
			t.Fatalf("%s must be refused", options)
		}
	}

	if _, err := cpp.DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root, LanguageOptions: []byte(`{"program":"build/app"}`)}); err == nil || !strings.Contains(err.Error(), "CodeLLDB") {
		t.Fatalf("missing CodeLLDB must be explained: %v", err)
	}
	debug, err := cpp.DebugAdapter(dap.LaunchRequest{Root: root, WorkingDirectory: root,
		LanguageOptions: []byte(`{"program":"build/app","adapter":"/tools/codelldb","programArguments":["-v"]}`)})
	if err != nil || debug.Executable != "/tools/codelldb" || debug.Transport != dap.TCPListen {
		t.Fatalf("debug: %+v %v", debug, err)
	}
	if command, launch := debug.Launch(""); command != "launch" || launch["type"] != "lldb" || launch["args"].([]string)[0] != "-v" {
		t.Fatalf("launch: %s %+v", command, launch)
	}
}
