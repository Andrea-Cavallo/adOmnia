package java

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"adomnia/internal/ide/dap"
)

// Comandi del Java Debug Server, esposti da JDT LS come workspace/executeCommand (vscode-java-debug).
const (
	CommandResolveMainClass   = "vscode.java.resolveMainClass"
	CommandResolveClasspath   = "vscode.java.resolveClasspath"
	CommandResolveJavaExec    = "vscode.java.resolveJavaExecutable"
	CommandBuildWorkspace     = "vscode.java.buildWorkspace"
	CommandStartDebugSession  = "vscode.java.startDebugSession"
	debugAdapterID            = "java"
	maxDebugArgumentsPerField = 256
)

// DebugOptions è ciò che l'host ha ricavato da JDT LS e dalla configurazione prima di collegarsi al
// debug adapter. Va in LaunchRequest.LanguageOptions come JSON.
type DebugOptions struct {
	// Address è host:porta del debug adapter aperto da `vscode.java.startDebugSession`.
	Address string `json:"address"`
	// AttachHost e AttachPort collegano il debugger a una JVM già in ascolto (-agentlib:jdwp=...server=y):
	// con AttachPort al posto di MainClass la richiesta DAP è `attach` e nessuna classe viene lanciata.
	AttachHost  string   `json:"attachHost,omitempty"`
	AttachPort  int      `json:"attachPort,omitempty"`
	MainClass   string   `json:"mainClass,omitempty"`
	ProjectName string   `json:"projectName,omitempty"`
	JavaExec    string   `json:"javaExec,omitempty"`
	ClassPaths  []string `json:"classPaths"`
	ModulePaths []string `json:"modulePaths,omitempty"`
	// ProgramArguments e VMArguments sono liste: qui diventano le stringhe che il server si aspetta.
	ProgramArguments []string          `json:"programArguments,omitempty"`
	VMArguments      []string          `json:"vmArguments,omitempty"`
	Environment      map[string]string `json:"environment,omitempty"`
}

// DebugAdapter implementa dap.DebugAdapterProvider: nessun processo da avviare (il server vive dentro
// JDT LS), solo il collegamento al suo endpoint DAP e gli argomenti della richiesta `launch`.
func (*Language) DebugAdapter(request dap.LaunchRequest) (dap.AdapterSpec, error) {
	var options DebugOptions
	if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
		return dap.AdapterSpec{}, fmt.Errorf("invalid Java debug options: %w", err)
	}
	if options.AttachPort != 0 {
		return attachSpec(options)
	}
	if options.Address == "" || options.MainClass == "" {
		return dap.AdapterSpec{}, fmt.Errorf("the Java debug session needs an adapter address and a main class")
	}
	if len(options.ProgramArguments) > maxDebugArgumentsPerField || len(options.VMArguments) > maxDebugArgumentsPerField {
		return dap.AdapterSpec{}, fmt.Errorf("too many arguments")
	}
	return dap.AdapterSpec{
		AdapterID: debugAdapterID, Address: options.Address, Transport: dap.TCPListen, Detach: true,
		Title: "Debug " + options.MainClass[strings.LastIndex(options.MainClass, ".")+1:],
		Launch: func(string) (string, map[string]any) {
			arguments := map[string]any{
				"request": "launch", "mainClass": options.MainClass, "classPaths": options.ClassPaths,
				"console": "internalConsole", "cwd": filepath.Clean(request.WorkingDirectory),
				"args": joinArguments(options.ProgramArguments), "vmArgs": joinArguments(options.VMArguments),
			}
			if options.ProjectName != "" {
				arguments["projectName"] = options.ProjectName
			}
			if options.JavaExec != "" {
				arguments["javaExec"] = options.JavaExec
			}
			if len(options.ModulePaths) > 0 {
				arguments["modulePaths"] = options.ModulePaths
			}
			if len(options.Environment) > 0 {
				arguments["env"] = options.Environment
			}
			return "launch", arguments
		},
	}, nil
}

// joinArguments produce la stringa di argomenti del Java Debug Server: separati da spazi, con virgolette
// per quelli che ne contengono (il server li ri-separa con le stesse regole di una riga di comando).
func joinArguments(arguments []string) string {
	quoted := make([]string, len(arguments))
	for i, argument := range arguments {
		if argument == "" || strings.ContainsAny(argument, " \t\"") {
			argument = `"` + strings.ReplaceAll(argument, `"`, `\"`) + `"`
		}
		quoted[i] = argument
	}
	return strings.Join(quoted, " ")
}

// attachTimeoutMillis è quanto il Java Debug Server riprova a collegarsi alla JVM: Maven e Gradle possono
// compilare per minuti prima di aprire la porta JDWP.
const attachTimeoutMillis = 180_000

func attachSpec(options DebugOptions) (dap.AdapterSpec, error) {
	if options.Address == "" || options.AttachPort < 1 || options.AttachPort > 65535 {
		return dap.AdapterSpec{}, fmt.Errorf("attaching needs the adapter address and a port between 1 and 65535")
	}
	host := options.AttachHost
	if host == "" {
		host = "127.0.0.1"
	}
	return dap.AdapterSpec{
		AdapterID: debugAdapterID, Address: options.Address, Transport: dap.TCPListen, Detach: true,
		Title: fmt.Sprintf("Attach %s:%d", host, options.AttachPort),
		Launch: func(string) (string, map[string]any) {
			arguments := map[string]any{"request": "attach", "hostName": host, "port": options.AttachPort, "timeout": attachTimeoutMillis}
			if options.ProjectName != "" {
				arguments["projectName"] = options.ProjectName
			}
			return "attach", arguments
		},
	}, nil
}
