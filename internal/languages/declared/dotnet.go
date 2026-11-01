package declared

import (
	"context"
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/process"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
	"github.com/Andrea-Cavallo/adOmnia/internal/procutil"
)

// KindDotnet runs a .NET project with `dotnet run`, which also builds it.
const KindDotnet = "dotnet"

// DotnetOptions are the LanguageOptions of a .NET run.
type DotnetOptions struct {
	// Project is the .csproj/.fsproj to run; empty runs the project of the working directory.
	Project string `json:"project,omitempty"`
}

// dotnetAdapter is a row whose projects run with the .NET CLI (C#, F#) and debug with netcoredbg.
type dotnetAdapter struct{ adapter }

func (dotnetAdapter) RunKinds() []string { return []string{KindDotnet} }

func (d dotnetAdapter) RunSchema(kind string) run.FieldSchema {
	fields := []run.Field{}
	if kind == KindDotnet {
		fields = append(fields, run.Field{Key: "project", Label: "Project", Type: run.FieldPath, Section: run.SectionBasic,
			Help: "The " + d.name + " project file to run; leave empty to run the project in the working directory."})
	}
	return run.FieldSchema{Language: d.id, Kind: kind, Fields: fields}
}

func dotnetOptions(kind string, data jsonv1.RawMessage) (DotnetOptions, error) {
	var options DotnetOptions
	if kind != KindDotnet {
		return options, fmt.Errorf("unsupported run type: %s", kind)
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &options); err != nil {
			return options, fmt.Errorf("enter valid project options")
		}
	}
	if options.Project = strings.TrimSpace(options.Project); strings.HasPrefix(options.Project, "-") || strings.ContainsAny(options.Project, "\x00\r\n") {
		return options, fmt.Errorf("select a valid project file")
	}
	return options, nil
}

func (dotnetAdapter) ValidateRunConfiguration(config run.Configuration) error {
	_, err := dotnetOptions(string(config.Kind), config.LanguageOptions)
	return err
}

func (d dotnetAdapter) CommandSpec(request run.Request) (run.CommandSpec, error) {
	options, err := dotnetOptions(request.Kind, request.LanguageOptions)
	if err != nil {
		return run.CommandSpec{}, err
	}
	binary, err := lookPath("dotnet")
	if err != nil {
		return run.CommandSpec{}, fmt.Errorf("dotnet is not on PATH: install the .NET SDK to run %s projects", d.name)
	}
	arguments := []string{"run"}
	if options.Project != "" {
		project, err := resolveProgram(request.Root, request.WorkingDirectory, options.Project)
		if err != nil {
			return run.CommandSpec{}, err
		}
		arguments = append(arguments, "--project", project)
	}
	if len(request.ProgramArguments) > 0 {
		arguments = append(append(arguments, "--"), request.ProgramArguments...)
	}
	return run.CommandSpec{Executable: binary, Arguments: arguments, WorkingDirectory: request.WorkingDirectory,
		Environment: append([]string(nil), request.Environment...)}, nil
}

// buildTimeout bounds the debug build: a first restore downloads packages, a hung MSBuild must not
// keep the Debug button busy forever.
const buildTimeout = 10 * time.Minute

// runDotnetBuild builds the project and prints its TargetPath; replaced in tests.
var runDotnetBuild = defaultRunDotnetBuild

func defaultRunDotnetBuild(dotnet, workingDirectory, project string, environment []string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), buildTimeout)
	defer cancel()
	command := procutil.CommandContext(ctx, dotnet, "build", project, "-c", "Debug", "-nologo", "-getProperty:TargetPath")
	command.Dir = workingDirectory
	command.Env = environment
	process.Configure(command, false)
	output, err := command.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("dotnet build failed: %s", lastLines(string(output), 12))
	}
	return output, nil
}

// DebugAdapter builds the project in Debug and launches its assembly under netcoredbg. The host
// sends the project file as NativeOptions.Program (empty: the project of the working directory).
func (d dotnetAdapter) DebugAdapter(request dap.LaunchRequest) (dap.AdapterSpec, error) {
	var options NativeOptions
	if len(request.LanguageOptions) > 0 {
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return dap.AdapterSpec{}, fmt.Errorf("enter valid project options")
		}
	}
	if _, err := dotnetOptions(KindDotnet, jsonv1.RawMessage(`{"project":`+strconv.Quote(options.Program)+`}`)); err != nil {
		return dap.AdapterSpec{}, err
	}
	project, err := d.projectFile(request.Root, request.WorkingDirectory, strings.TrimSpace(options.Program))
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	debugger, err := lookPath("netcoredbg")
	if err != nil {
		return dap.AdapterSpec{}, fmt.Errorf("netcoredbg is not on PATH: download it from https://github.com/Samsung/netcoredbg/releases and add its folder to PATH")
	}
	dotnet, err := lookPath("dotnet")
	if err != nil {
		return dap.AdapterSpec{}, fmt.Errorf("dotnet is not on PATH: install the .NET SDK to debug %s projects", d.name)
	}
	output, err := runDotnetBuild(dotnet, request.WorkingDirectory, project, buildEnvironment(request.Environment))
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	assembly, err := assemblyOf(request.Root, project, output)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	// The program inherits netcoredbg's environment: the full run environment from the host.
	configuration := map[string]any{"type": "coreclr", "request": "launch", "program": assembly,
		"args": append([]string{}, options.ProgramArguments...), "cwd": request.WorkingDirectory, "stopAtEntry": false}
	return dap.AdapterSpec{
		AdapterID: d.id, Executable: debugger, Arguments: []string{"--interpreter=vscode"},
		WorkingDirectory: request.WorkingDirectory, Environment: append([]string(nil), request.Environment...),
		Transport: dap.Stdio, Title: "Debug " + filepath.Base(assembly),
		Launch:       func(string) (string, map[string]any) { return "launch", configuration },
		ExplainError: func(err error) error { return fmt.Errorf("netcoredbg could not launch the program: %w", err) },
	}, nil
}

// projectFile is the chosen project, or the only .csproj/.fsproj of the working directory.
func (d dotnetAdapter) projectFile(root, workingDirectory, chosen string) (string, error) {
	if chosen != "" {
		return resolveProgram(root, workingDirectory, chosen)
	}
	var found []string
	for _, pattern := range d.manifests {
		if strings.HasSuffix(pattern, "proj") {
			matches, _ := filepath.Glob(filepath.Join(workingDirectory, pattern))
			found = append(found, matches...)
		}
	}
	if len(found) != 1 {
		return "", fmt.Errorf("select the project to debug: the working directory has %d project files", len(found))
	}
	return resolveProgram(root, workingDirectory, found[0])
}

// assemblyOf reads the TargetPath printed by the build (last non-empty line); with an SDK older
// than .NET 8 it falls back to the newest <name>.dll under bin/Debug/<tfm>/.
func assemblyOf(root, project string, output []byte) (string, error) {
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	if candidate := strings.TrimSpace(lines[len(lines)-1]); strings.EqualFold(filepath.Ext(candidate), ".dll") {
		if !filepath.IsAbs(candidate) {
			candidate = filepath.Join(filepath.Dir(project), candidate)
		}
		return resolveProgram(root, root, candidate)
	}
	name := strings.TrimSuffix(filepath.Base(project), filepath.Ext(project))
	matches, _ := filepath.Glob(filepath.Join(filepath.Dir(project), "bin", "Debug", "*", name+".dll"))
	newest, newestTime := "", time.Time{}
	for _, match := range matches {
		if info, err := os.Stat(match); err == nil && info.ModTime().After(newestTime) {
			newest, newestTime = match, info.ModTime()
		}
	}
	if newest == "" {
		return "", fmt.Errorf("the build did not produce %s.dll: set <AssemblyName> or build the project once", name)
	}
	return resolveProgram(root, root, newest)
}

// buildEnvironment is the full run environment sent by the host; the process one when it sends none.
func buildEnvironment(environment []string) []string {
	if len(environment) == 0 {
		return os.Environ()
	}
	return append([]string(nil), environment...)
}

func lastLines(text string, count int) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	if len(lines) > count {
		lines = lines[len(lines)-count:]
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}
