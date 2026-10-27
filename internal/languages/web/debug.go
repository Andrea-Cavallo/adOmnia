package web

import (
	"encoding/json/v2"
	"fmt"
	"maps"
	"net"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Andrea-Cavallo/adOmnia/internal/ide/dap"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/run"
)

// DebugOptions sono le opzioni di LanguageOptions del debug JS/TS. `kind` dice cosa si avvia:
//   - "script": un file del progetto eseguito da Node (`program`);
//   - "command": il comando del package manager della Run (`runtimeExecutable` + `runtimeArgs`,
//     es. `npm run dev`), con autoAttach dei processi figli.
//
// Adapter è il server DAP di js-debug risolto dall'host (LocateJSDebug): qui non si cerca nulla nel
// PATH, così l'installazione gestita e verificata resta l'unica fonte.
type DebugOptions struct {
	Kind              string   `json:"kind"`
	Program           string   `json:"program,omitempty"`
	RuntimeExecutable string   `json:"runtimeExecutable,omitempty"`
	RuntimeArgs       []string `json:"runtimeArgs,omitempty"`
	ProgramArguments  []string `json:"programArguments,omitempty"`
	// Node è il runtime da usare per il programma; vuoto = il `node` del PATH.
	Node    string `json:"node,omitempty"`
	Adapter string `json:"adapter,omitempty"`
}

// scriptDebugger è l'adapter JS/TS registrato nel registry: all'adapter base aggiunge il debug DAP
// con js-debug (installazione gestita e verificata). Il target debuggato vive in una sessione figlia
// multiplexata, che il DebugManager del core apre da sé (richiesta inversa startDebugging).
type scriptDebugger struct{ scriptAdapter }

// ScriptLanguage restituisce l'adapter JS/TS con il debug: l'host lo usa per costruire lo spec senza
// duplicare le opzioni.
func ScriptLanguage() language.Language {
	return scriptDebugger{scriptAdapter{adapter{kindFor(ScriptID)}}}
}

// DebugAdapter implementa dap.DebugAdapterProvider con js-debug: il server DAP è un processo Node
// locale in ascolto su una porta di loopback scelta da noi, e il programma (o il comando npm) è
// figlio dell'adapter. Breakpoint, step, variabili ed evaluate sono quelli del DebugManager generico.
func (scriptDebugger) DebugAdapter(request dap.LaunchRequest) (dap.AdapterSpec, error) {
	var options DebugOptions
	if len(request.LanguageOptions) > 0 {
		if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
			return dap.AdapterSpec{}, fmt.Errorf("enter valid JavaScript debug options")
		}
	}
	if strings.TrimSpace(options.Adapter) == "" {
		return dap.AdapterSpec{}, fmt.Errorf("the JavaScript debugger (js-debug) is not installed: install it from the editor notice, or run Tools → Install the JavaScript debugger")
	}
	if !isFile(options.Adapter) {
		return dap.AdapterSpec{}, fmt.Errorf("the configured js-debug server does not exist: reinstall it from the editor notice")
	}
	node, err := debugNode(options.Node)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	configuration, title, err := debugConfiguration(request, options)
	if err != nil {
		return dap.AdapterSpec{}, err
	}
	address, port, err := debugLoopbackAddress()
	if err != nil {
		return dap.AdapterSpec{}, fmt.Errorf("could not reserve a port for the JavaScript debugger: %w", err)
	}
	return dap.AdapterSpec{
		AdapterID:  "pwa-node",
		Executable: node,
		// Il server DAP riceve indirizzo e porta e li stampa: usiamo l'indirizzo noto, come per
		// debugpy e CodeLLDB, invece di leggere un pattern dall'output.
		Arguments:        []string{options.Adapter, strconv.Itoa(port), "127.0.0.1"},
		WorkingDirectory: request.WorkingDirectory,
		Environment:      append([]string(nil), request.Environment...),
		Address:          address,
		Title:            title,
		ZeroFrameIDs:     true,
		Launch: func(string) (string, map[string]any) {
			return "launch", configuration
		},
		// js-debug avvia il target come sessione figlia: il client apre un'altra connessione allo
		// stesso server e le passa la configurazione ricevuta (con __pendingTargetId).
		ChildSession: func(request string, child map[string]any) (dap.AdapterSpec, error) {
			configuration := make(map[string]any, len(child)+1)
			maps.Copy(configuration, child)
			if _, ok := configuration["type"]; !ok {
				configuration["type"] = "pwa-node"
			}
			return dap.AdapterSpec{
				AdapterID: "pwa-node", Address: address, Title: title,
				Launch: func(string) (string, map[string]any) { return request, configuration },
			}, nil
		},
		ExplainError: func(err error) error {
			if strings.Contains(strings.ToLower(err.Error()), "connect") {
				return fmt.Errorf("js-debug did not accept the session: check that Node.js is on the PATH and that the installed debugger is the pinned release (%w)", err)
			}
			return err
		},
	}, nil
}

// debugNode risolve il runtime Node del programma: quello scelto esplicitamente, altrimenti il
// `node` del PATH. Node è un prerequisito dichiarato, non viene installato né cercato altrove.
func debugNode(configured string) (string, error) {
	if node := strings.TrimSpace(configured); node != "" {
		if !isFile(node) {
			return "", fmt.Errorf("the selected Node.js runtime does not exist: %s", node)
		}
		return node, nil
	}
	binary, err := lookPath("node")
	if err != nil {
		return "", fmt.Errorf("Node.js was not found on this machine: install the current LTS from https://nodejs.org and restart adOmnia")
	}
	return binary, nil
}

// debugConfiguration traduce le opzioni nella configurazione di lancio di js-debug e nel titolo
// della sessione. La validazione è la stessa della Run: niente percorsi fuori dal progetto.
func debugConfiguration(request dap.LaunchRequest, options DebugOptions) (map[string]any, string, error) {
	configuration := map[string]any{
		"type": "pwa-node", "request": "launch",
		"cwd": request.WorkingDirectory,
		// La console interna porta stdout/stderr nel pannello Debug senza aprire terminali.
		"console": "internalConsole", "outputCapture": "std",
		"sourceMaps": true, "skipFiles": []string{"<node_internals>/**"},
	}
	switch options.Kind {
	case "script":
		program := strings.TrimSpace(options.Program)
		if program == "" {
			return nil, "", fmt.Errorf("choose the JavaScript or TypeScript file to debug")
		}
		if err := run.ValidateTarget(request.Root, request.WorkingDirectory, program); err != nil {
			return nil, "", err
		}
		absolute := filepath.Join(request.WorkingDirectory, filepath.FromSlash(program))
		if !isFile(absolute) {
			return nil, "", fmt.Errorf("the file to debug does not exist: %s", program)
		}
		configuration["program"] = absolute
		configuration["name"] = "Debug " + filepath.Base(absolute)
		if len(options.ProgramArguments) > 0 {
			configuration["args"] = options.ProgramArguments
		}
		return configuration, "Debug " + filepath.Base(absolute), nil
	case "command":
		executable := strings.TrimSpace(options.RuntimeExecutable)
		if executable == "" {
			return nil, "", fmt.Errorf("choose the command to debug, for example npm run dev")
		}
		configuration["runtimeExecutable"] = executable
		if len(options.RuntimeArgs) > 0 {
			configuration["runtimeArgs"] = options.RuntimeArgs
		}
		// `npm run dev` avvia Node come figlio: senza autoAttach i breakpoint del progetto non
		// verrebbero mai colpiti.
		configuration["autoAttachChildProcesses"] = true
		title := "Debug " + executable
		if len(options.RuntimeArgs) > 0 {
			title += " " + strings.Join(options.RuntimeArgs, " ")
		}
		configuration["name"] = title
		return configuration, title, nil
	default:
		return nil, "", fmt.Errorf("unsupported JavaScript debug kind: %s", options.Kind)
	}
}

// debugLoopbackAddress prenota una porta libera su 127.0.0.1: il server DAP è raggiungibile dal solo
// processo locale, mai su tutte le interfacce.
func debugLoopbackAddress() (string, int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", 0, err
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), port, nil
}
