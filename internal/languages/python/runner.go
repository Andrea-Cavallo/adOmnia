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

// Options sono le opzioni di LanguageOptions delle configurazioni Python. L'interprete è
// opzionale: senza scelta esplicita vale la selezione del progetto, poi l'ambiente locale e il
// PATH (PY-0.3: la macchina non entra nel file condiviso delle configurazioni).
type Options struct {
	Interpreter string `json:"interpreter,omitempty"`
	Script      string `json:"script,omitempty"`
	Module      string `json:"module,omitempty"`
}

var moduleName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$`)

func (*Language) RunKinds() []string { return []string{"script", "module"} }

// optionsFor interpreta e valida le opzioni del kind. La validazione è statica: l'interprete si
// risolve e si controlla alla partenza (serve il progetto autorizzato per eseguire).
func optionsFor(kind string, data json.RawMessage) (Options, error) {
	var options Options
	if err := json.Unmarshal(data, &options); err != nil {
		return options, fmt.Errorf("enter valid Python run options")
	}
	if options.Interpreter != "" {
		if !filepath.IsAbs(options.Interpreter) || strings.ContainsAny(options.Interpreter, "\x00\r\n") {
			return options, fmt.Errorf("select the absolute path of a Python interpreter")
		}
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
	interpreter, err := ResolveInterpreter(request.Root, request.WorkingDirectory, options.Interpreter)
	if err != nil {
		return run.CommandSpec{}, err
	}
	args := []string{"-u"}
	if request.Kind == "module" {
		args = append(args, "-m", options.Module)
	} else {
		script, err := resolveScript(request.Root, request.WorkingDirectory, options.Script)
		if err != nil {
			return run.CommandSpec{}, err
		}
		args = append(args, script)
	}
	args = append(args, request.ProgramArguments...)
	return run.CommandSpec{Executable: interpreter.Path, Arguments: args, WorkingDirectory: request.WorkingDirectory, Environment: append([]string(nil), request.Environment...)}, nil
}

// resolveScript risolve il percorso dello script e lo confina al progetto: symlink compresi
// (PY-3.2), perché `..` o un link fuori dalla radice non devono passare.
func resolveScript(root, workingDirectory, script string) (string, error) {
	if !filepath.IsAbs(script) {
		script = filepath.Join(workingDirectory, script)
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("cannot resolve project root")
	}
	resolved, err := filepath.EvalSymlinks(script)
	if err != nil {
		return "", fmt.Errorf("Python script does not exist")
	}
	relative, err := filepath.Rel(resolvedRoot, resolved)
	if err != nil || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("Python script must be inside the project")
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("select a Python script file")
	}
	return resolved, nil
}

func (*Language) RunSchema(kind string) run.FieldSchema {
	fields := []run.Field{{Key: "interpreter", Label: "Python interpreter", Type: run.FieldPath, Section: run.SectionBasic, Help: "Optional absolute path to python in the environment to use. Empty means the project selection, the project environment (.venv) or the PATH."}}
	switch kind {
	case "script":
		fields = append(fields, run.Field{Key: "script", Label: "Script", Type: run.FieldPath, Section: run.SectionBasic, Required: true, Help: "A .py file inside the project, relative to the working directory or absolute."})
	case "module":
		fields = append(fields, run.Field{Key: "module", Label: "Module", Type: run.FieldText, Section: run.SectionBasic, Required: true, Help: "For example package.main. Runs with python -m; PYTHONPATH is not changed."})
	}
	return run.FieldSchema{Language: ID, Kind: kind, Fields: fields}
}
