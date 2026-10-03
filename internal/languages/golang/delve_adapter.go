package golang

import (
	"adomnia/internal/ide/dap"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

const (
	debugModeAttach = "attach"
	debugModeRemote = "remote"
)

type DebugRequest struct {
	SessionID dap.SessionID `json:"sessionId"`
	// Mode è "debug" (programma), "test", "attach" (processo locale) o "remote" (dlv --headless già avviato).
	Mode string `json:"mode"`
	// ProcessID è il processo a cui agganciarsi in modalità attach.
	ProcessID int `json:"processId,omitempty"`
	// Address è host:porta del server Delve in modalità remote.
	Address string `json:"address,omitempty"`
	// WorkingDirectory è la cartella del modulo relativa al progetto.
	WorkingDirectory string `json:"workingDirectory"`
	// Target è il package relativo al modulo, es. "." o "./cmd/api".
	Target           string            `json:"target"`
	TestName         string            `json:"testName,omitempty"`
	ProgramArguments []string          `json:"programArguments,omitempty"`
	BuildTags        []string          `json:"buildTags,omitempty"`
	Environment      map[string]string `json:"environment,omitempty"`
	// EnvFile e BuildFlags arrivano dalla configurazione Run attiva.
	EnvFile    string   `json:"envFile,omitempty"`
	BuildFlags []string `json:"buildFlags,omitempty"`
}

func delveLaunchArguments(buildDir string, request DebugRequest, program, moduleDir string) (string, map[string]any) {
	switch request.Mode {
	case debugModeAttach:
		return "attach", map[string]any{"request": "attach", "mode": "local", "processId": request.ProcessID}
	case debugModeRemote:
		return "attach", map[string]any{"request": "attach", "mode": "remote"}
	}
	arguments := map[string]any{
		"request": "launch", "mode": request.Mode, "program": program, "cwd": moduleDir, "stopOnEntry": false,
		"output": filepath.Join(buildDir, debugBinaryName()),
		// Come GoLand: variabili di package nel pannello Variables e solo le goroutine dell'utente.
		"showGlobalVariables": true, "hideSystemGoroutines": true,
	}
	args := append([]string(nil), request.ProgramArguments...)
	if request.Mode == "test" && request.TestName != "" {
		args = append([]string{"-test.run", request.TestName}, args...)
	}
	if len(args) > 0 {
		arguments["args"] = args
	}
	buildFlags := append([]string(nil), request.BuildFlags...)
	if len(request.BuildTags) > 0 {
		buildFlags = append(buildFlags, "-tags="+strings.Join(request.BuildTags, ","))
	}
	if len(buildFlags) > 0 {
		arguments["buildFlags"] = strings.Join(buildFlags, " ")
	}
	return "launch", arguments
}
func debugTitle(request DebugRequest) string {
	switch request.Mode {
	case debugModeAttach:
		return fmt.Sprintf("attach %d", request.ProcessID)
	case debugModeRemote:
		return "remote " + request.Address
	}
	if request.Mode == "test" {
		name := request.TestName
		if name == "^$" {
			for index, argument := range request.ProgramArguments {
				if argument == "-test.bench" && index+1 < len(request.ProgramArguments) {
					name = request.ProgramArguments[index+1]
				}
			}
		}
		if name = strings.NewReplacer("^", "", "$", "").Replace(name); name != "" {
			return name
		}
		return "tests " + request.Target
	}
	target := strings.TrimPrefix(strings.TrimSpace(request.Target), "./")
	if target == "" || target == "." {
		return "main"
	}
	return target
}
func debugBinaryName() string {
	if runtime.GOOS == "windows" {
		return "__debug_bin.exe"
	}
	return "__debug_bin"
}
func explainLaunchError(err error) error {
	if strings.Contains(err.Error(), "too old for this version of Delve") {
		return fmt.Errorf("the project Go SDK is older than this Delve supports: select a newer SDK (Go → Go SDKs & Toolchains…) or point to a compatible dlv (Go → Tool Paths…). Details: %w", err)
	}
	return fmt.Errorf("avvio del programma in debug fallito: %w", err)
}

const (
	evaluateErrorPrefix = "Unable to evaluate expression: "
	evaluateNeedsCall   = "function calls not allowed without using 'call'"
)

var missingSymbol = regexp.MustCompile(`could not find symbol (?:value for )?(\S+)`)

// explainEvaluateError traduce gli errori di Delve in messaggi brevi e azionabili.
func explainEvaluateError(err error, context string) error {
	message := strings.TrimPrefix(err.Error(), evaluateErrorPrefix)
	if match := missingSymbol.FindStringSubmatch(message); match != nil {
		return fmt.Errorf("%s is not visible in the selected frame", match[1])
	}
	if strings.Contains(message, evaluateNeedsCall) && context != "repl" {
		return fmt.Errorf("function calls run only from the Debug console")
	}
	return fmt.Errorf("%s", message)
}

func (*Language) DebugAdapter(request dap.LaunchRequest) (dap.AdapterSpec, error) {
	var options DebugRequest
	if err := json.Unmarshal(request.LanguageOptions, &options); err != nil {
		return dap.AdapterSpec{}, err
	}
	spec := dap.AdapterSpec{AdapterID: ID, Executable: request.Executable, Arguments: []string{"dap", "--listen=127.0.0.1:0"}, Environment: request.Environment, WorkingDirectory: request.WorkingDirectory, Transport: dap.TCPListen, ReadyPattern: `^DAP server listening at: (.*)$`, Title: debugTitle(options), Detach: options.Mode == debugModeAttach || options.Mode == debugModeRemote, PanicFunction: "runtime.gopanic", ExplainError: explainLaunchError, ExplainEvaluateError: explainEvaluateError}
	if options.Mode == debugModeRemote {
		spec.Address = options.Address
	}
	spec.Launch = func(buildDir string) (string, map[string]any) {
		return delveLaunchArguments(buildDir, options, request.Program, request.WorkingDirectory)
	}
	spec.RetryEvaluate = func(expression, context string, err error) (string, bool) {
		if context == "repl" && strings.Contains(err.Error(), evaluateNeedsCall) {
			return "call " + expression, true
		}
		return "", false
	}
	return spec, nil
}
func DebugTitle(request DebugRequest) string { return debugTitle(request) }
func DebugBinaryName() string                { return debugBinaryName() }
