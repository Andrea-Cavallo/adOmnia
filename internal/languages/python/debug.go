package python

import (
	"encoding/json"
	"fmt"
	"net"
	"path/filepath"
	"strconv"
	"strings"

	"adomnia/internal/ide/dap"
	idetesting "adomnia/internal/ide/testing"
)

// DebugOptions sono le opzioni di LanguageOptions del debug Python: lo stesso target della Run
// (script, modulo o pytest) più la scelta di limitare il debugger al codice del progetto.
type DebugOptions struct {
	Interpreter      string   `json:"interpreter,omitempty"`
	Kind             string   `json:"kind"`
	Script           string   `json:"script,omitempty"`
	Module           string   `json:"module,omitempty"`
	Targets          []string `json:"targets,omitempty"`
	Run              string   `json:"run,omitempty"`
	ProgramArguments []string `json:"programArguments,omitempty"`
	// JustMyCode limita il debugger al codice del progetto (default come VS Code: true).
	JustMyCode *bool `json:"justMyCode,omitempty"`
}

// DebugAdapter implementa dap.DebugAdapterProvider con debugpy: il programma debuggato ospita
// debugpy e parla DAP sulla porta di loopback scelta da noi; il DebugManager generico fa il
// resto (breakpoint, step, variabili, evaluate). debugpy deve essere installato nell'interprete
// del programma: non viene installato né modificato nessun ambiente in automatico (PY-6.1).
func (*Language) DebugAdapter(request dap.LaunchRequest) (dap.AdapterSpec, error) {
	var options DebugOptions
	if len(request.LanguageOptions) > 0 {
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return dap.AdapterSpec{}, fmt.Errorf("enter valid Python debug options")
		}
	}
	interpreter, err := ResolveInterpreter(request.Root, request.WorkingDirectory, options.Interpreter)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	targets, title, err := debugTarget(request, options)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	address, err := loopbackAddress()
	if err != nil {
		return dap.AdapterSpec{}, fmt.Errorf("could not reserve a port for the Python debugger: %w", err)
	}
	arguments := []string{"-u", "-m", "debugpy", "--listen", address, "--wait-for-client"}
	arguments = append(arguments, targets...)
	justMyCode := true
	if options.JustMyCode != nil {
		justMyCode = *options.JustMyCode
	}
	return dap.AdapterSpec{
		AdapterID: "python",
		Executable: interpreter.Path, Arguments: arguments,
		WorkingDirectory: request.WorkingDirectory,
		Environment:      append([]string(nil), request.Environment...),
		// Address con un processo da avviare: debugpy ascolta su una porta che scegliamo noi e
		// non la stampa, quindi il DebugManager si collega all'indirizzo noto (loopback).
		Address: address,
		Title:   title,
		Launch: func(string) (string, map[string]any) {
			return "attach", map[string]any{
				"name": "python", "type": "python", "request": "attach",
				"justMyCode": justMyCode,
				// L'output del programma arriva già dalla console del processo: senza
				// redirect lo vedrebbe due volte.
				"redirectOutput": false,
				"subProcess":      false,
			}
		},
		ExplainError: func(err error) error {
			if strings.Contains(err.Error(), "attach") {
				return fmt.Errorf("debugpy did not accept the session: check that debugpy is installed in the selected interpreter (python -m pip install debugpy) (%w)", err)
			}
			return err
		},
	}, nil
}

// debugTarget traduce le opzioni negli argomenti del programma debuggato e nel titolo della
// sessione. La validazione è la stessa della Run e dei test: niente opzioni mascherate da target.
func debugTarget(request dap.LaunchRequest, options DebugOptions) ([]string, string, error) {
	switch options.Kind {
	case "script":
		script, err := resolveScript(request.Root, request.WorkingDirectory, options.Script)
		if err != nil {
			return nil, "", err
		}
		return append([]string{script}, options.ProgramArguments...), "Debug " + filepath.Base(script), nil
	case "module":
		if !moduleName.MatchString(options.Module) {
			return nil, "", fmt.Errorf("enter a Python module name, for example package.main")
		}
		return append([]string{"-m", options.Module}, options.ProgramArguments...), "Debug " + options.Module, nil
	case "pytest":
		selection, err := testTargets(idetesting.Request{Root: request.Root, WorkingDirectory: request.WorkingDirectory}, TestOptions{Packages: options.Targets, Run: options.Run})
		if err != nil {
			return nil, "", err
		}
		if len(selection) == 0 {
			selection = []string{"."}
		}
		arguments := append([]string{"-m", "pytest"}, selection...)
		switch {
		case options.Run == "":
		case strings.HasPrefix(options.Run, "k:"):
			arguments = append(arguments, "-k", strings.TrimPrefix(options.Run, "k:"))
		default:
			arguments = append(arguments, options.Run)
		}
		return arguments, "Debug pytest", nil
	default:
		return nil, "", fmt.Errorf("unsupported Python debug kind: %s", options.Kind)
	}
}

// loopbackAddress prenota una porta libera su 127.0.0.1: serve al solo processo locale, mai
// esposta su tutte le interfacce (PY-6.3).
func loopbackAddress() (string, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), nil
}
