package codestudio

import (
	"adomnia/internal/ide/remote"
	"bytes"
	"fmt"
	"os"
	"sync"
)

type DevContainerResult struct {
	RunID  RunID         `json:"runId"`
	Target remote.Target `json:"target"`
	Error  string        `json:"error,omitempty"`
}

// Explicit trusted startup; the process manager owns output, cancellation and shutdown.
func (s *Service) StartDevContainer(sessionID string) (Execution, error) {
	session, err := s.session(sessionID)
	if err != nil {
		return Execution{}, err
	}
	if session.Project.Authorization != AuthorizationPermitted {
		return Execution{}, fmt.Errorf("authorize project tools before starting a dev container")
	}
	config := ""
	for _, candidate := range []string{".devcontainer/devcontainer.json", ".devcontainer.json"} {
		if resolved, e := s.documents.ResolveProjectPath(session.Project, candidate); e == nil {
			config = resolved
			break
		}
	}
	if config == "" {
		return Execution{}, fmt.Errorf("no .devcontainer/devcontainer.json or .devcontainer.json in this project")
	}
	executable, prefix, err := remote.DevContainerCLI()
	if err != nil {
		return Execution{}, err
	}
	var output bytes.Buffer
	var mu sync.Mutex
	overflow := false
	return s.processes.Start(CommandSpec{SessionID: session.ID, Kind: "devcontainer", Executable: executable, Arguments: append(prefix, "up", "--workspace-folder", session.Project.RealPath, "--config", config, "--log-format", "json"), WorkingDirectory: session.Project.RealPath, Environment: os.Environ(), DisplayCommand: "devcontainer up --workspace-folder .", OutputTap: func(stream string, data []byte) {
		if stream != "stdout" {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if output.Len()+len(data) > 2<<20 {
			overflow = true
			return
		}
		output.Write(data)
	}, OnExit: func(run Execution) {
		result := DevContainerResult{RunID: run.ID}
		mu.Lock()
		text := output.String()
		tooLarge := overflow
		mu.Unlock()
		if run.Status != "exited" || run.Error != "" {
			result.Error = run.Error
			if result.Error == "" {
				result.Error = "dev container startup cancelled or failed"
			}
		} else if tooLarge {
			result.Error = "dev container result exceeded 2 MiB"
		} else {
			target, e := remote.ParseDevContainerResult(text)
			if e != nil {
				result.Error = e.Error()
			} else {
				target.DevContainerConfig = config
				result.Target = target
			}
		}
		s.emit("devcontainer.ready", session.ID, string(run.ID), result)
	}})
}
