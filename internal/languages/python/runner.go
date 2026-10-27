package python

import (
	jsonv1 "encoding/json"
	"encoding/json/v2"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// Options sono le opzioni di LanguageOptions delle configurazioni Python. L'interprete è
// opzionale: senza scelta esplicita vale la selezione del progetto, poi l'ambiente locale e il
// PATH (PY-0.3: la macchina non entra nel file condiviso delle configurazioni).
//
// App, Host, Port e Reload sono i campi guidati dei server framework (uvicorn, flask): valgono
// solo per `module` e solo per quei moduli, così un normale `python -m pkg` resta invariato.
type Options struct {
	Interpreter string `json:"interpreter,omitempty"`
	Script      string `json:"script,omitempty"`
	Module      string `json:"module,omitempty"`
	App         string `json:"app,omitempty"`
	Host        string `json:"host,omitempty"`
	Port        int    `json:"port,omitzero"`
	Reload      bool   `json:"reload,omitzero"`
}

// frameworkModules sono i moduli per cui i campi host/porta hanno un significato.
var frameworkModules = map[string]bool{"uvicorn": true, "flask": true}

var appTarget = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*(:[A-Za-z_][A-Za-z0-9_]*)?$`)

// serverArguments costruisce gli argomenti del server framework dai campi guidati; ok è false per
// un modulo normale, che segue `python -m <modulo>`.
func serverArguments(options Options) (arguments []string, ok bool) {
	if !frameworkModules[options.Module] {
		return nil, false
	}
	if options.Module == "flask" {
		arguments = []string{"-m", "flask", "--app", options.App, "run"}
		if options.Host != "" {
			arguments = append(arguments, "--host", options.Host)
		}
		if options.Port > 0 {
			arguments = append(arguments, "--port", strconv.Itoa(options.Port))
		}
		if options.Reload {
			arguments = append(arguments, "--debug")
		}
		return arguments, true
	}
	arguments = []string{"-m", "uvicorn", options.App}
	if options.Host != "" {
		arguments = append(arguments, "--host", options.Host)
	}
	if options.Port > 0 {
		arguments = append(arguments, "--port", strconv.Itoa(options.Port))
	}
	if options.Reload {
		arguments = append(arguments, "--reload")
	}
	return arguments, true
}

// validateServerOptions controlla i campi guidati: app `modulo[:attributo]`, host senza schema né
// spazi, porta nel range valido. Gli altri moduli non devono portare questi campi.
func validateServerOptions(options Options) error {
	if !frameworkModules[options.Module] {
		if options.App != "" || options.Host != "" || options.Port != 0 || options.Reload {
			return fmt.Errorf("host, port, app and reload belong to a uvicorn or flask module")
		}
		return nil
	}
	if !appTarget.MatchString(options.App) {
		return fmt.Errorf("enter the app as module:attribute, for example app.main:app")
	}
	if options.Host != "" && (strings.ContainsAny(options.Host, " \t/\\\x00\r\n") || strings.Contains(options.Host, "://")) {
		return fmt.Errorf("enter a host name or address, for example 127.0.0.1")
	}
	if options.Port < 0 || options.Port > 65535 {
		return fmt.Errorf("enter a port between 1 and 65535")
	}
	return nil
}

var moduleName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$`)

func (*Language) RunKinds() []string { return []string{"script", "module"} }

// optionsFor interpreta e valida le opzioni del kind. La validazione è statica: l'interprete si
// risolve e si controlla alla partenza (serve il progetto autorizzato per eseguire).
func optionsFor(kind string, data jsonv1.RawMessage) (Options, error) {
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
		if err := validateServerOptions(options); err != nil {
			return options, err
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
		if framework, ok := serverArguments(options); ok {
			args = append(args, framework...)
		} else {
			args = append(args, "-m", options.Module)
		}
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
		fields = append(fields,
			run.Field{Key: "app", Label: "App", Type: run.FieldText, Section: run.SectionBasic, Help: "Framework server only: module:attribute, for example app.main:app.", VisibleWhen: frameworkOnly()},
			run.Field{Key: "host", Label: "Host", Type: run.FieldText, Section: run.SectionBasic, Default: "127.0.0.1", Help: "Address the server binds to; leave empty for the framework default.", VisibleWhen: frameworkOnly()},
			run.Field{Key: "port", Label: "Port", Type: run.FieldText, Section: run.SectionBasic, Help: "Port the server listens on; empty means the framework default (8000 uvicorn, 5000 Flask).", VisibleWhen: frameworkOnly()},
			run.Field{Key: "reload", Label: "Reload on change", Type: run.FieldToggle, Section: run.SectionAdvanced, Help: "Development only: restarts the server when a file changes. Debug never uses the reloader.", VisibleWhen: frameworkOnly()},
		)
	}
	return run.FieldSchema{Language: ID, Kind: kind, Fields: fields}
}

// frameworkOnly mostra un campo quando il modulo è un server framework riconosciuto.
func frameworkOnly() *run.FieldCondition {
	return &run.FieldCondition{Field: "module", Equals: []string{"uvicorn", "flask"}}
}
