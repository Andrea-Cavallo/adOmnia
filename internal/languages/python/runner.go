package python

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"adomnia/internal/ide/run"
)

// Interpreter is explicit until per-unit environment discovery is implemented.
// No PATH lookup, shell activation, package installation or environment sync occurs here.
type Options struct {
	Interpreter string `json:"interpreter"`
	Script      string `json:"script,omitempty"`
	Module      string `json:"module,omitempty"`
}

var moduleName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$`)

func (*Language) RunKinds() []string { return []string{"script", "module"} }

func optionsFor(kind string, data json.RawMessage) (Options, error) {
	var options Options
	if err := json.Unmarshal(data, &options); err != nil {
		return options, fmt.Errorf("enter valid Python run options")
	}
	if !filepath.IsAbs(options.Interpreter) || strings.ContainsAny(options.Interpreter, "\x00\r\n") {
		return options, fmt.Errorf("select the absolute path of a Python interpreter")
	}
	switch kind {
	case "script":
		if options.Script == "" || strings.HasPrefix(options.Script, "-") || !strings.EqualFold(filepath.Ext(options.Script), ".py") || strings.ContainsAny(options.Script, "\x00\r\n") {
			return options, fmt.Errorf("select a Python .py script")
		}
	case "module":
		if !moduleName.MatchString(options.Module) {
			return options, fmt.Errorf("enter a Python module name, for example package.main")
		}
	default:
		return options, fmt.Errorf("unsupported Python run kind: %s", kind)
	}
	return options, nil
}

func (*Language) ValidateRunConfiguration(config run.Configuration) error {
	_, err := optionsFor(string(config.Kind), config.LanguageOptions)
	return err
}

func (*Language) CommandSpec(request run.Request) (run.CommandSpec, error) {
	options, err := optionsFor(request.Kind, request.LanguageOptions)
	if err != nil {
		return run.CommandSpec{}, err
	}
	info, err := os.Stat(options.Interpreter)
	if err != nil || !info.Mode().IsRegular() {
		return run.CommandSpec{}, fmt.Errorf("Python interpreter is missing: select an installed interpreter")
	}
	args := []string{"-u"}
	if request.Kind == "module" {
		args = append(args, "-m", options.Module)
	} else {
		script := options.Script
		if !filepath.IsAbs(script) {
			script = filepath.Join(request.WorkingDirectory, script)
		}
		root, err := filepath.EvalSymlinks(request.Root)
		if err != nil {
			return run.CommandSpec{}, fmt.Errorf("cannot resolve project root")
		}
		script, err = filepath.EvalSymlinks(script)
		if err != nil {
			return run.CommandSpec{}, fmt.Errorf("Python script does not exist")
		}
		rel, err := filepath.Rel(root, script)
		if err != nil || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return run.CommandSpec{}, fmt.Errorf("Python script must be inside the project")
		}
		info, err := os.Stat(script)
		if err != nil || !info.Mode().IsRegular() {
			return run.CommandSpec{}, fmt.Errorf("select a Python script file")
		}
		args = append(args, script)
	}
	args = append(args, request.ProgramArguments...)
	return run.CommandSpec{Executable: options.Interpreter, Arguments: args, WorkingDirectory: request.WorkingDirectory, Environment: append([]string(nil), request.Environment...)}, nil
}

func (*Language) RunSchema(kind string) run.FieldSchema {
	fields := []run.Field{{Key: "interpreter", Label: "Python interpreter", Type: run.FieldPath, Section: run.SectionBasic, Required: true, Help: "Absolute path to python.exe or bin/python in your environment. No packages are installed automatically."}}
	switch kind {
	case "script":
		fields = append(fields, run.Field{Key: "script", Label: "Script", Type: run.FieldPath, Section: run.SectionBasic, Required: true, Help: "A .py file inside the project, relative to the working directory or absolute."})
	case "module":
		fields = append(fields, run.Field{Key: "module", Label: "Module", Type: run.FieldText, Section: run.SectionBasic, Required: true, Help: "For example package.main. Runs with python -m; PYTHONPATH is not changed."})
	}
	return run.FieldSchema{Language: ID, Kind: kind, Fields: fields}
}
