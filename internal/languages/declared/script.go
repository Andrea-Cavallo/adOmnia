package declared

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/lsp"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// KindScript runs one source file with the language's interpreter (php, ruby, dart run, elixir, pwsh).
const KindScript = "script"

// ScriptOptions are the LanguageOptions of a script run.
type ScriptOptions struct {
	// Script is the file to run, inside the project, relative to the working directory or absolute.
	Script string `json:"script"`
}

// scriptAdapter is a row whose files run directly with an interpreter on PATH.
type scriptAdapter struct{ adapter }

func (scriptAdapter) RunKinds() []string { return []string{KindScript} }

func (s scriptAdapter) RunSchema(kind string) run.FieldSchema {
	fields := []run.Field{}
	if kind == KindScript {
		fields = append(fields, run.Field{Key: "script", Label: "Script", Type: run.FieldPath, Section: run.SectionBasic, Required: true,
			Help: "A " + s.name + " file inside the project, relative to the working directory or absolute."})
	}
	return run.FieldSchema{Language: s.id, Kind: kind, Fields: fields}
}

func scriptOptions(kind string, data jsonv1.RawMessage) (ScriptOptions, error) {
	var options ScriptOptions
	if kind != KindScript {
		return options, fmt.Errorf("unsupported run type: %s", kind)
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &options); err != nil {
			return options, fmt.Errorf("enter valid script options")
		}
	}
	if options.Script = strings.TrimSpace(options.Script); options.Script == "" || strings.HasPrefix(options.Script, "-") || strings.ContainsAny(options.Script, "\x00\r\n") {
		return options, fmt.Errorf("select the script to run")
	}
	return options, nil
}

func (scriptAdapter) ValidateRunConfiguration(config run.Configuration) error {
	_, err := scriptOptions(string(config.Kind), config.LanguageOptions)
	return err
}

func (s scriptAdapter) CommandSpec(request run.Request) (run.CommandSpec, error) {
	options, err := scriptOptions(request.Kind, request.LanguageOptions)
	if err != nil {
		return run.CommandSpec{}, err
	}
	script, err := resolveProgram(request.Root, request.WorkingDirectory, options.Script)
	if err != nil {
		return run.CommandSpec{}, err
	}
	for _, interpreter := range s.interpreters {
		binary, err := lookPath(interpreter.command)
		if err != nil {
			continue
		}
		arguments := append(append(append([]string(nil), interpreter.args...), script), request.ProgramArguments...)
		return run.CommandSpec{Executable: binary, Arguments: arguments, WorkingDirectory: request.WorkingDirectory,
			Environment: append([]string(nil), request.Environment...)}, nil
	}
	return run.CommandSpec{}, fmt.Errorf("%s is not on PATH: install %s to run the script", s.interpreters[0].command, s.name)
}

// debugger is a DAP adapter on PATH that launches one script (stdio transport).
type debugger struct {
	command string
	args    []string
	// dapType is the launch configuration's "type".
	dapType string
	// runtime names the interpreter in the launch configuration ("runtimeExecutable" for PHP).
	runtime bool
	hint    string
	// managed locates an adapter installed by adOmnia (executable + arguments); nil when none.
	managed func(toolsRoot string) (string, []string, bool)
	// install describes how to install the adapter; nil means the hint is the only way.
	install func(toolsRoot string) (lsp.InstallPlan, error)
}

// DebuggerInstallPlan implements language.DebuggerInstaller for rows with an installable debugger.
func (s scriptAdapter) DebuggerInstallPlan(toolsRoot string) (lsp.InstallPlan, error) {
	if s.debugger == nil || s.debugger.install == nil {
		return lsp.InstallPlan{}, fmt.Errorf("%s has no installable debugger: %s", s.name, s.debuggerHint())
	}
	return s.debugger.install(toolsRoot)
}

func (s scriptAdapter) debuggerHint() string {
	if s.debugger != nil {
		return s.debugger.hint
	}
	return "no debug adapter is known for this language"
}

// DebugAdapter launches the script under the row's debugger. The host sends the script as
// NativeOptions.Program, the same request native executables use.
func (s scriptAdapter) DebugAdapter(request dap.LaunchRequest) (dap.AdapterSpec, error) {
	if s.debugger == nil {
		return dap.AdapterSpec{}, fmt.Errorf("%s scripts cannot be debugged yet", s.name)
	}
	var options NativeOptions
	if len(request.LanguageOptions) > 0 {
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return dap.AdapterSpec{}, fmt.Errorf("enter valid script options")
		}
	}
	if options.Program = strings.TrimSpace(options.Program); options.Program == "" || strings.HasPrefix(options.Program, "-") {
		return dap.AdapterSpec{}, fmt.Errorf("select the script to debug")
	}
	script, err := resolveProgram(request.Root, request.WorkingDirectory, options.Program)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	adapterBinary, arguments := "", []string(nil)
	if s.debugger.managed != nil && request.ToolsRoot != "" {
		adapterBinary, arguments, _ = s.debugger.managed(request.ToolsRoot)
	}
	if adapterBinary == "" {
		binary, err := lookPath(s.debugger.command)
		if err != nil {
			return dap.AdapterSpec{}, fmt.Errorf("%s is not on PATH: %s", s.debugger.command, s.debugger.hint)
		}
		adapterBinary, arguments = binary, append([]string(nil), s.debugger.args...)
	}
	configuration := map[string]any{"type": s.debugger.dapType, "request": "launch", "program": script,
		"cwd": request.WorkingDirectory, "args": append([]string{}, options.ProgramArguments...)}
	if s.debugger.runtime {
		interpreter, err := lookPath(s.interpreters[0].command)
		if err != nil {
			return dap.AdapterSpec{}, fmt.Errorf("%s is not on PATH: install %s to debug the script", s.interpreters[0].command, s.name)
		}
		configuration["runtimeExecutable"] = interpreter
	}
	return dap.AdapterSpec{
		AdapterID: s.id, Executable: adapterBinary, Arguments: arguments,
		WorkingDirectory: request.WorkingDirectory, Environment: append([]string(nil), request.Environment...),
		Transport: dap.Stdio, Title: "Debug " + filepath.Base(script),
		Launch: func(string) (string, map[string]any) { return "launch", configuration },
		ExplainError: func(err error) error {
			return fmt.Errorf("%s could not launch the script: %w", s.debugger.command, err)
		},
	}, nil
}
