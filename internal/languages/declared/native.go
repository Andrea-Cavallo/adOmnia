package declared

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// KindExecutable runs (and debugs) a program the project already built. Building stays the
// user's tool (make, cmake, zig build, swift build) as a Before launch task: no build system is guessed.
const KindExecutable = "executable"

// NativeOptions are the LanguageOptions of an executable run or debug.
type NativeOptions struct {
	// Program is the built executable, inside the project, relative to the working directory or absolute.
	Program string `json:"program"`
	// ProgramArguments are passed to the program when debugging (Run takes them from the request).
	ProgramArguments []string `json:"programArguments,omitempty"`
	// Adapter is the CodeLLDB located by the host (debug only).
	Adapter string `json:"adapter,omitempty"`
}

// nativeAdapter is a row whose programs are native code that LLDB debugs (C, C++, Objective-C, Zig, Swift).
type nativeAdapter struct{ adapter }

// UsesLLDB implements language.NativeLLDBDebugger: the host locates CodeLLDB/lldb-dap only for these rows.
func (nativeAdapter) UsesLLDB() bool { return true }

func (n nativeAdapter) RunKinds() []string {
	kinds := []string{KindExecutable}
	if n.build {
		kinds = append(kinds, KindBuildRun)
	}
	return kinds
}

func (n nativeAdapter) RunSchema(kind string) run.FieldSchema {
	fields := []run.Field{}
	switch kind {
	case KindExecutable:
		fields = append(fields, run.Field{Key: "program", Label: "Executable", Type: run.FieldPath, Section: run.SectionBasic, Required: true,
			Help: "The built program inside the project, for example build/app. Build it with a Before launch task (make, cmake --build, zig build…)."})
	case KindBuildRun:
		fields = append(fields, run.Field{Key: "source", Label: "Source file", Type: run.FieldPath, Section: run.SectionBasic, Required: true,
			Help: "A C or C++ file with main. adOmnia compiles it (and the other sources in its folder) and runs the program; make and a C/C++ compiler must be on PATH."})
	}
	return run.FieldSchema{Language: n.id, Kind: kind, Fields: fields}
}

func nativeOptions(kind string, data jsonv1.RawMessage) (NativeOptions, error) {
	var options NativeOptions
	if kind != KindExecutable {
		return options, fmt.Errorf("unsupported run type: %s", kind)
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &options); err != nil {
			return options, fmt.Errorf("enter valid executable options")
		}
	}
	if options.Program = strings.TrimSpace(options.Program); options.Program == "" || strings.HasPrefix(options.Program, "-") || strings.ContainsAny(options.Program, "\x00\r\n") {
		return options, fmt.Errorf("select the executable to run")
	}
	return options, nil
}

func (nativeAdapter) ValidateRunConfiguration(config run.Configuration) error {
	if string(config.Kind) == KindBuildRun {
		_, err := buildRunOptions(config.LanguageOptions)
		return err
	}
	_, err := nativeOptions(string(config.Kind), config.LanguageOptions)
	return err
}

func (n nativeAdapter) CommandSpec(request run.Request) (run.CommandSpec, error) {
	if request.Kind == KindBuildRun {
		return n.buildRunCommandSpec(request)
	}
	options, err := nativeOptions(request.Kind, request.LanguageOptions)
	if err != nil {
		return run.CommandSpec{}, err
	}
	program, err := resolveProgram(request.Root, request.WorkingDirectory, options.Program)
	if err != nil {
		return run.CommandSpec{}, err
	}
	return run.CommandSpec{Executable: program, Arguments: append([]string(nil), request.ProgramArguments...),
		WorkingDirectory: request.WorkingDirectory, Environment: append([]string(nil), request.Environment...)}, nil
}

// DebugAdapter launches the executable under CodeLLDB, the adapter Rust already uses.
func (n nativeAdapter) DebugAdapter(request dap.LaunchRequest) (dap.AdapterSpec, error) {
	options, err := nativeOptions(KindExecutable, request.LanguageOptions)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	program, err := resolveProgram(request.Root, request.WorkingDirectory, options.Program)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	arguments := append([]string{}, options.ProgramArguments...)
	if options.Adapter == "" {
		return lldbDAP(n.id, program, arguments, request)
	}
	// CodeLLDB does not announce its port: reserve a free loopback one and pass it with --port.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return dap.AdapterSpec{}, fmt.Errorf("could not reserve a loopback port for the debugger: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		return dap.AdapterSpec{}, fmt.Errorf("could not reserve a loopback port for the debugger: %w", err)
	}
	return dap.AdapterSpec{
		AdapterID: n.id, Executable: options.Adapter, Arguments: []string{"--port", strconv.Itoa(port)},
		WorkingDirectory: request.WorkingDirectory, Environment: append([]string(nil), request.Environment...),
		Transport: dap.TCPListen, Address: "127.0.0.1:" + strconv.Itoa(port),
		Title: "Debug " + filepath.Base(program),
		Launch: func(string) (string, map[string]any) {
			return "launch", map[string]any{"type": "lldb", "request": "launch", "program": program, "args": arguments, "cwd": request.WorkingDirectory}
		},
		ExplainError: func(err error) error { return fmt.Errorf("CodeLLDB could not launch the program: %w", err) },
	}, nil
}

// lldbDAP is LLVM's own adapter (stdio), the fallback when CodeLLDB is not installed: it ships with
// LLVM and with Swift 6 toolchains.
func lldbDAP(id, program string, arguments []string, request dap.LaunchRequest) (dap.AdapterSpec, error) {
	binary, err := lookPath("lldb-dap")
	if err != nil {
		return dap.AdapterSpec{}, fmt.Errorf("no debugger found: run 'Install C/C++ Debugger…' from the command palette, install CodeLLDB, or put LLVM's lldb-dap on PATH")
	}
	return dap.AdapterSpec{
		AdapterID: id, Executable: binary, WorkingDirectory: request.WorkingDirectory,
		Environment: append([]string(nil), request.Environment...), Transport: dap.Stdio,
		Title: "Debug " + filepath.Base(program),
		Launch: func(string) (string, map[string]any) {
			return "launch", map[string]any{"program": program, "args": arguments, "cwd": request.WorkingDirectory}
		},
		ExplainError: func(err error) error { return fmt.Errorf("lldb-dap could not launch the program: %w", err) },
	}, nil
}

// resolveProgram confines the executable to the project, symlinks included.
func resolveProgram(root, workingDirectory, program string) (string, error) {
	if !filepath.IsAbs(program) {
		program = filepath.Join(workingDirectory, program)
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("cannot resolve project root")
	}
	resolved, err := filepath.EvalSymlinks(program)
	if err != nil {
		return "", fmt.Errorf("%s does not exist", filepath.Base(program))
	}
	relative, err := filepath.Rel(resolvedRoot, resolved)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", fmt.Errorf("the file to run must be inside the project")
	}
	if info, err := os.Stat(resolved); err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("select a file, not a folder")
	}
	return resolved, nil
}
